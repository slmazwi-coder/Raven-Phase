import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  type MediaStream,
} from 'react-native-webrtc';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';
import { useAuth } from './AuthContext';
import { fetchGroup, fetchGroupMembers, type GroupMember } from '@/lib/api';

type CallState = 'idle' | 'outgoing' | 'incoming' | 'connected' | 'ended' | 'busy' | 'unavailable';

interface RemotePeer {
  id: string;
  fullName: string;
  avatar?: string | null;
}

interface CallContextValue {
  state: CallState;
  activeGroupId: string | null;
  remote: RemotePeer | null;
  duration: number;
  isMuted: boolean;
  isSpeaker: boolean;
  startCall: (groupId: string, remote?: RemotePeer) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const router = useRouter();

  const [state, setState] = useState<CallState>('idle');
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemotePeer | null>(null);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const incomingOfferRef = useRef<{ type: string; sdp: string } | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    incomingOfferRef.current = null;
    setState('idle');
    setActiveGroupId(null);
    setRemote(null);
    setDuration(0);
    setIsMuted(false);
    setIsSpeaker(false);
  }, []);

  const sendWs = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const resolveRemote = useCallback(
    async (groupId: string, memberId?: string) => {
      if (!token) return null;
      try {
        if (memberId) {
          const { members } = await fetchGroupMembers(groupId, token);
          const other = members.find((m) => m.id === memberId);
          if (other) {
            return { id: other.id, fullName: other.fullName, avatar: other.avatar };
          }
        }
        const { group } = await fetchGroup(groupId, token);
        if (group.isDirect && group.name.startsWith('DM: ')) {
          const otherName = group.name.slice(4).split(' & ').find((n) => n !== group.name);
          return { id: memberId || group.id, fullName: otherName || group.name, avatar: group.avatar };
        }
        return { id: memberId || group.id, fullName: group.name, avatar: group.avatar };
      } catch {
        return { id: memberId || groupId, fullName: 'Unknown', avatar: null };
      }
    },
    [token],
  );

  const attachPeerEvents = useCallback(
    (pc: RTCPeerConnection, groupId: string) => {
      // EventTarget types are not fully exposed in the React Native type graph,
      // so we access the W3C-style event methods directly on the peer object.
      const peer = pc as any;

      peer.addEventListener('icecandidate', (event: any) => {
        const candidate = event.candidate?.toJSON ? event.candidate.toJSON() : event.candidate;
        if (candidate && candidate.candidate) {
          sendWs({ type: 'call_ice_candidate', groupId, candidate });
        }
      });

      peer.addEventListener('track', () => {
        // Audio is routed automatically by the native WebRTC module.
      });

      peer.addEventListener('connectionstatechange', () => {
        const connectionState = peer.connectionState;
        if (connectionState === 'failed' || connectionState === 'closed' || connectionState === 'disconnected') {
          setState('ended');
          reset();
        }
      });
    },
    [sendWs, reset],
  );

  const startCall = useCallback(
    async (groupId: string, initialRemote?: RemotePeer) => {
      if (!token) return;
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission', 'Microphone permission is required for calls');
        return;
      }

      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;
        attachPeerEvents(pc, groupId);

        stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendWs({ type: 'call_offer', groupId, sdp: offer.sdp });

        setActiveGroupId(groupId);
        setRemote(initialRemote || (await resolveRemote(groupId)));
        setState('outgoing');
        router.push({ pathname: '/call/[id]', params: { id: groupId } });
      } catch (err) {
        console.error('[call] start failed', err);
        reset();
      }
    },
    [token, sendWs, attachPeerEvents, resolveRemote, router, reset],
  );

  const acceptCall = useCallback(async () => {
    const groupId = activeGroupId;
    const offer = incomingOfferRef.current;
    if (!groupId || !offer || !token) return;

    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') return;

    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      attachPeerEvents(pc, groupId);

      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offer.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendWs({ type: 'call_answer', groupId, sdp: answer.sdp });
      setState('connected');
      durationRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err) {
      console.error('[call] accept failed', err);
      endCall();
    }
  }, [activeGroupId, token, attachPeerEvents, sendWs]);

  const rejectCall = useCallback(() => {
    if (activeGroupId) {
      sendWs({ type: 'call_reject', groupId: activeGroupId });
    }
    reset();
    router.back();
  }, [activeGroupId, sendWs, reset, router]);

  const endCall = useCallback(() => {
    if (activeGroupId) {
      sendWs({ type: 'call_end', groupId: activeGroupId });
    }
    reset();
    router.back();
  }, [activeGroupId, sendWs, reset, router]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !isMuted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setIsMuted(next);
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    setIsSpeaker((s) => !s);
  }, []);

  useEffect(() => {
    if (!token) return;
    const domain = process.env.EXPO_PUBLIC_WS_DOMAIN || process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return;

    const ws = new WebSocket(`wss://${domain}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {};
    ws.onclose = () => {};
    ws.onerror = () => {};

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(
          typeof event.data === 'string' ? event.data : event.data.toString(),
        );

        if (
          msg.type === 'call_offer' ||
          msg.type === 'call_answer' ||
          msg.type === 'call_ice_candidate' ||
          msg.type === 'call_end' ||
          msg.type === 'call_reject' ||
          msg.type === 'call_busy' ||
          msg.type === 'call_unavailable'
        ) {
          const groupId = msg.groupId;

          if (msg.type === 'call_offer') {
            if (stateRef.current !== 'idle') {
              sendWs({ type: 'call_busy', groupId });
              return;
            }
            incomingOfferRef.current = { type: 'offer', sdp: msg.sdp };
            const peer = await resolveRemote(groupId, msg.from);
            setActiveGroupId(groupId);
            setRemote(peer);
            setState('incoming');
            router.push({ pathname: '/call/[id]', params: { id: groupId } });
            return;
          }

          const pc = pcRef.current;
          if (msg.type === 'call_answer' && pc) {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
            setState('connected');
            durationRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
            return;
          }

          if (msg.type === 'call_ice_candidate' && pc) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (err) {
              console.warn('[call] addIceCandidate failed', err);
            }
            return;
          }

          if (msg.type === 'call_end' || msg.type === 'call_reject' || msg.type === 'call_unavailable') {
            setState(msg.type === 'call_unavailable' ? 'unavailable' : 'ended');
            reset();
            router.back();
            return;
          }

          if (msg.type === 'call_busy') {
            setState('busy');
            setTimeout(() => {
              reset();
              router.back();
            }, 1500);
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [token, sendWs, resolveRemote, router, reset]);

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  const value: CallContextValue = {
    state,
    activeGroupId,
    remote,
    duration,
    isMuted,
    isSpeaker,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleSpeaker,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
}
