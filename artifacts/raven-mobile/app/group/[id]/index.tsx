import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Platform,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File as FSFile, Paths as FSPaths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import colors from '@/constants/colors';
import {
  fetchMessages,
  fetchGroupMembers,
  fetchGroup,
  sendTextMessage,
  sendMediaMessage,
  markGroupAsRead,
  leaveGroup,
  deleteGroup,
  clearGroupChat,
  type ChatMessage,
} from '@/lib/api';
import { useGroupChat } from '@/lib/ws';
import { useAuth } from '@/context/AuthContext';
import { useSecurity } from '@/context/SecurityContext';
import { useCall } from '@/context/CallContext';

const C = colors.light;
const MAX_MEDIA_BYTES = 3 * 1024 * 1024; // 3 MB cap for data-uri storage

interface BubbleProps {
  msg: ChatMessage;
  isMine: boolean;
  showSender: boolean;
  memberCount: number;
  otherMembers: { id: string }[];
}

function formatBytes(bytes?: number | null) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageStatus({ msg, isMine, memberCount, otherMembers }: BubbleProps) {
  if (!isMine) return null;

  const otherIds = otherMembers.map((m) => m.id);
  const readByOthers = (msg.readBy ?? []).filter((id) => id !== msg.senderId);
  const readCount = readByOthers.length;
  const allRead = memberCount > 1 && readCount >= otherIds.length;

  const color = allRead ? C.primary : 'rgba(233,237,239,0.65)';
  const icon = allRead ? 'check-circle' : 'check';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4, gap: -6 }}>
      <Feather name="check" size={10} color={color} />
      <Feather name={icon} size={10} color={color} style={{ marginLeft: -5 }} />
    </View>
  );
}

function MediaBubble({
  msg,
  isMine,
}: {
  msg: ChatMessage;
  isMine: boolean;
}) {
  const uri = msg.mediaUrl ?? '';

  if (msg.contentType === 'image') {
    return (
      <Pressable onPress={() => Linking.openURL(uri).catch(() => {})}>
        <Image source={{ uri }} style={styles.mediaImage} resizeMode="cover" />
      </Pressable>
    );
  }

  if (msg.contentType === 'audio') {
    return <VoiceNotePlayer uri={uri} isMine={isMine} />;
  }

  return (
    <Pressable
      onPress={() => Linking.openURL(uri).catch(() => {})}
      style={styles.documentRow}
    >
      <Feather name="file-text" size={28} color={isMine ? '#fff' : C.primary} />
      <View style={styles.documentInfo}>
        <Text
          style={[styles.documentName, isMine && styles.documentNameMine]}
          numberOfLines={1}
        >
          {msg.mediaName || 'Document'}
        </Text>
        <Text style={[styles.documentMeta, isMine && styles.documentMetaMine]}>
          {formatBytes(msg.mediaSize)}
        </Text>
      </View>
    </Pressable>
  );
}

function VoiceNotePlayer({ uri, isMine }: { uri: string; isMine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const fileUriRef = useRef<string | null>(null);

  async function resolveFileUri(): Promise<string | null> {
    if (!uri.startsWith('data:')) return uri;
    if (fileUriRef.current) return fileUriRef.current;

    const match = uri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    const base64 = match[2];
    const ext = mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'aac';

    try {
      const file = new FSFile(FSPaths.cache, `raven-voice-${Date.now()}.${ext}`);
      file.create();
      await file.write(base64, { encoding: 'base64' });
      fileUriRef.current = file.uri;
      return file.uri;
    } catch (e) {
      console.warn('Voice note write error', e);
      return null;
    }
  }

  async function toggle() {
    if (!uri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (!soundRef.current) {
        const fileUri = await resolveFileUri();
        if (!fileUri) {
          Alert.alert('Voice note', 'Could not prepare voice note for playback');
          return;
        }
        const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          setPlaying(status.isPlaying);
          if (status.didJustFinish) {
            setPlaying(false);
            soundRef.current?.setPositionAsync(0);
          }
        });
        await sound.playAsync();
      } else {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await soundRef.current.pauseAsync();
        } else {
          await soundRef.current.playAsync();
        }
      }
    } catch (e) {
      console.warn('Voice playback error', e);
    }
  }

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  return (
    <Pressable onPress={toggle} style={styles.voiceRow}>
      <Feather name={playing ? 'pause' : 'play'} size={22} color={isMine ? '#fff' : C.primary} />
      <Text style={[styles.voiceText, isMine && styles.voiceTextMine]}>Voice note</Text>
    </Pressable>
  );
}

function Bubble({ msg, isMine, showSender, memberCount, otherMembers }: BubbleProps) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const hasMedia = msg.contentType !== 'text' && msg.mediaUrl;

  return (
    <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
      <View
        style={[
          styles.bubble,
          isMine ? styles.bubbleSent : styles.bubbleReceived,
        ]}
      >
        {showSender && !isMine ? (
          <Text style={styles.senderName}>{msg.senderName}</Text>
        ) : null}
        {hasMedia ? <MediaBubble msg={msg} isMine={isMine} /> : null}
        {msg.content ? (
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
            {msg.content}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end' }}>
          <Text
            style={[
              styles.bubbleTime,
              isMine ? styles.bubbleTimeMine : styles.bubbleTimeOther,
            ]}
          >
            {time}
          </Text>
          <MessageStatus
            msg={msg}
            isMine={isMine}
            memberCount={memberCount}
            otherMembers={otherMembers}
            showSender={showSender}
          />
        </View>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { token, member } = useAuth();
  const queryClient = useQueryClient();
  const { setActiveGroupId, lastEnforcement, clearLastEnforcement } = useSecurity();
  const { startCall } = useCall();

  const [inputText, setInputText] = useState('');
  const [showAttachments, setShowAttachments] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    setActiveGroupId(groupId ?? null);
    return () => setActiveGroupId(null);
  }, [groupId, setActiveGroupId]);

  useEffect(() => {
    if (!lastEnforcement) return;
    const messages: Record<string, string> = {
      warn: 'Screenshot/recording detected. This incident has been logged.',
      mute: `You have been muted until ${lastEnforcement.mutedUntil ? new Date(lastEnforcement.mutedUntil).toLocaleString() : 'the expiry time'}`,
      remove: 'You have been removed from this group.',
      ban: 'You have been banned from Raven.',
    };
    Alert.alert('Security policy enforced', messages[lastEnforcement.action] ?? 'A security policy was enforced.');
    if (lastEnforcement.action === 'remove' || lastEnforcement.action === 'ban') {
      router.replace('/(tabs)');
    }
    clearLastEnforcement();
  }, [lastEnforcement, clearLastEnforcement, router]);

  const { data: groupData } = useQuery({
    queryKey: ['group', groupId, token],
    queryFn: () => fetchGroup(groupId!, token!),
    enabled: !!groupId && !!token,
  });

  const { data: membersData } = useQuery({
    queryKey: ['group-members', groupId, token],
    queryFn: () => fetchGroupMembers(groupId!, token!),
    enabled: !!groupId && !!token,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['messages', groupId, token],
    queryFn: () => fetchMessages(groupId!, token!),
    enabled: !!groupId && !!token,
  });

  const readMutation = useMutation({
    mutationFn: () => markGroupAsRead(groupId!, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['messages', groupId] });
    },
  });

  const markRead = useCallback(() => {
    readMutation.mutate();
  }, [readMutation]);

  const {
    messages: wsMessages,
    sendTyping,
    prependHistory,
    updateMessage,
    typingUsers,
    notifyTyping,
    presence,
    isConnected,
  } = useGroupChat(groupId ?? null, token, { markRead });

  const historyMessages = useMemo(
    () => [...(historyData?.messages ?? [])].reverse(),
    [historyData?.messages],
  );

  useEffect(() => {
    if (historyMessages.length) {
      prependHistory(historyMessages);
      markRead();
    }
  }, [historyMessages, prependHistory, markRead]);

  useEffect(() => {
    const last = wsMessages[0];
    if (last && last.senderId !== member?.id) {
      markRead();
    }
  }, [wsMessages, member?.id, markRead]);

  const groupName = groupData?.group.name ?? 'Group';
  const isDirect = groupData?.group.isDirect ?? false;
  const members = membersData?.members ?? [];
  const memberCount = members.length;
  const otherMembers = members.filter((m) => m.id !== member?.id);

  function lastSeenText(date?: string | null) {
    if (!date) return 'offline';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'last seen just now';
    if (mins < 60) return `last seen ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `last seen ${hours}h ago`;
    return `last seen ${Math.floor(hours / 24)}d ago`;
  }

  const otherMember = otherMembers[0];
  const isOtherOnline = otherMember && !!presence[otherMember.id];
  const headerSub = isDirect
    ? isOtherOnline
      ? 'online'
      : lastSeenText(otherMember?.lastSeenAt)
    : `${memberCount} member${memberCount !== 1 ? 's' : ''}`;

  const myMembership = members.find((m) => m.id === member?.id);
  const isAdmin = myMembership?.roleInGroup === 'admin';
  const isCreator = groupData?.group.createdBy === member?.id;

  const leaveMutation = useMutation({
    mutationFn: () => leaveGroup(groupId!, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.replace('/(tabs)');
    },
    onError: (e: any) => Alert.alert('Could not leave group', e?.message ?? 'Please try again'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGroup(groupId!, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.replace('/(tabs)');
    },
    onError: (e: any) => Alert.alert('Could not delete group', e?.message ?? 'Please try again'),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearGroupChat(groupId!, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', groupId] });
      Alert.alert('Chat history cleared');
    },
    onError: (e: any) => Alert.alert('Could not clear chat', e?.message ?? 'Please try again'),
  });

  function handleLeave() {
    const title = isDirect ? 'Delete chat' : 'Leave group';
    const message = isDirect
      ? 'This will delete the conversation.'
      : 'You will be removed from this group. The chat history will remain for other members.';
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isDirect ? 'Delete' : 'Leave',
        style: 'destructive',
        onPress: () => leaveMutation.mutate(),
      },
    ]);
  }

  function handleDelete() {
    Alert.alert(
      'Delete group',
      'This cannot be undone. All messages and members will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(),
        },
      ],
    );
  }

  function handleClear() {
    Alert.alert('Clear chat history', 'All messages will be deleted for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => clearMutation.mutate(),
      },
    ]);
  }

  function showChatMenu() {
    const options: { text: string; onPress?: () => void; style?: 'destructive' | 'cancel' }[] = [
      { text: 'Members', onPress: () => router.push(`/group/${groupId}/members`) },
    ];

    if (!isDirect) {
      if (isAdmin) {
        options.push({ text: 'Clear chat history', onPress: handleClear });
        options.push({ text: 'Delete group', onPress: handleDelete, style: 'destructive' });
      }
      options.push({ text: 'Leave group', onPress: handleLeave, style: 'destructive' });
    } else {
      options.push({ text: 'Delete chat', onPress: handleLeave, style: 'destructive' });
    }

    options.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert('Group options', '', options as any);
  }

  function handleCall() {
    if (!isDirect) {
      Alert.alert('Voice call', 'Calls are available for direct chats.');
      return;
    }
    const remote = otherMember
      ? { id: otherMember.id, fullName: otherMember.fullName, avatar: otherMember.avatar ?? null }
      : undefined;
    startCall(groupId, remote);
  }

  function handleVideo() {
    Alert.alert('Video call', 'Video calls are not enabled yet.');
  }

  const typingText =
    typingUsers.length > 0
      ? `${typingUsers.length === 1 ? 'Someone' : `${typingUsers.length} people`} typing…`
      : null;

  const handleSend = useCallback(async () => {
    const content = inputText.trim();
    if (!content || !token || !groupId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSending(true);
    try {
      const { message } = await sendTextMessage(groupId, token, content);
      updateMessage(message);
      sendTyping(false);
      setInputText('');
    } catch (e: any) {
      Alert.alert('Send failed', e?.message ?? 'Could not send message');
    } finally {
      setIsSending(false);
    }
  }, [inputText, token, groupId, updateMessage, sendTyping]);

  const handleInputChange = useCallback(
    (text: string) => {
      setInputText(text);
      if (text.trim()) notifyTyping();
    },
    [notifyTyping],
  );

  async function uploadMedia(
    contentType: 'image' | 'audio' | 'document',
    uri: string,
    name?: string,
    mime?: string,
    size?: number,
  ) {
    if (!token || !groupId) return;
    if (size && size > MAX_MEDIA_BYTES) {
      Alert.alert('File too large', 'This file is over the 3 MB cap. Try a smaller file.');
      return;
    }

    setSendingMedia(true);
    try {
      let base64: string | undefined;
      if (uri.startsWith('data:')) {
        base64 = uri.split(',')[1];
      } else {
        const file = new FSFile(uri);
        if (!file.exists) {
          Alert.alert('File not found');
          return;
        }
        const fileSize = file.size;
        if (fileSize > MAX_MEDIA_BYTES) {
          Alert.alert('File too large', 'This file is over the 3 MB cap. Try a smaller file.');
          return;
        }
        base64 = await file.base64();
      }
      if (!base64) {
        Alert.alert('Could not read file');
        return;
      }

      const dataUri = uri.startsWith('data:')
        ? uri
        : `data:${mime || 'application/octet-stream'};base64,${base64}`;

      const caption = inputText.trim();
      const { message } = await sendMediaMessage(groupId, token, {
        content: caption,
        content_type: contentType,
        media_url: dataUri,
        media_name: name || (contentType === 'audio' ? 'Voice note' : 'Document'),
        media_mime: mime,
        media_size: size,
      });
      updateMessage(message);
      setInputText('');
    } catch (e: any) {
      Alert.alert('Send failed', e?.message ?? 'Could not send media');
    } finally {
      setSendingMedia(false);
    }
  }

  async function pickImage(source: 'library' | 'camera') {
    const { status } =
      source === 'library'
        ? await ImagePicker.requestMediaLibraryPermissionsAsync()
        : await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed');
      return;
    }

    const result =
      source === 'library'
        ? await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.9,
            base64: false,
          })
        : await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.9,
            base64: false,
          });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    const asset = result.assets[0];
    setSendingMedia(true);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) {
        Alert.alert('Could not compress image');
        return;
      }
      const size = manipulated.base64.length * 0.75; // approximate
      await uploadMedia(
        'image',
        `data:image/jpeg;base64,${manipulated.base64}`,
        asset.fileName || 'image.jpg',
        'image/jpeg',
        size,
      );
    } catch (e: any) {
      Alert.alert('Image failed', e?.message ?? 'Could not send image');
    } finally {
      setSendingMedia(false);
    }
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    await uploadMedia(
      'document',
      asset.uri,
      asset.name,
      asset.mimeType,
      asset.size ?? undefined,
    );
  }

  async function toggleRecording() {
    if (recording) {
      try {
        await recordingRef.current?.stopAndUnloadAsync();
        const uri = recordingRef.current?.getURI();
        recordingRef.current = null;
        setRecording(false);
        if (uri) {
          const file = new FSFile(uri);
          await uploadMedia('audio', uri, 'Voice note', 'audio/m4a', file.exists ? file.size : undefined);
        }
      } catch (e) {
        console.warn('Recording stop error', e);
      }
      return;
    }

    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Microphone permission needed');
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setRecording(true);
    } catch (e: any) {
      Alert.alert('Could not start recording', e?.message ?? 'Please check microphone permissions.');
    }
  }

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Pressable
          style={styles.headerMeta}
          onPress={() => {
            if (isDirect && otherMember) {
              router.push(`/user/${otherMember.id}`);
            } else {
              router.push(`/group/${groupId}/members`);
            }
          }}
        >
          {otherMember?.avatar ? (
            <Image source={{ uri: otherMember.avatar }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarInitial}>
                {groupName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.headerText}>
            <Text style={styles.headerName} numberOfLines={1}>
              {groupName}
            </Text>
            {memberCount > 0 ? (
              <Text style={styles.headerSub}>{headerSub}</Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable onPress={handleCall} style={styles.headerAction} hitSlop={12}>
          <Feather name="phone" size={20} color={C.text} />
        </Pressable>
        <Pressable onPress={handleVideo} style={styles.headerAction} hitSlop={12}>
          <Feather name="video" size={20} color={C.text} />
        </Pressable>
        <Pressable
          onPress={showChatMenu}
          style={styles.menuBtn}
          hitSlop={12}
        >
          <Feather name="more-vertical" size={22} color={C.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {historyLoading && wsMessages.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.primary} size="large" />
          </View>
        ) : wsMessages.length === 0 ? (
          <View style={styles.emptyChat}>
            <Feather name="message-circle" size={44} color={C.textTertiary} />
            <Text style={styles.emptyChatText}>No messages yet</Text>
            <Text style={styles.emptyChatSub}>Be the first to say hi.</Text>
          </View>
        ) : (
          <FlatList
            data={wsMessages}
            keyExtractor={(item) => item.id}
            inverted
            renderItem={({ item, index }) => {
              const isMine = item.senderId === member?.id;
              const prevMsg = wsMessages[index + 1];
              const showSender =
                !isMine && (!prevMsg || prevMsg.senderId !== item.senderId);
              return (
                <Bubble
                  msg={item}
                  isMine={isMine}
                  showSender={showSender}
                  memberCount={memberCount}
                  otherMembers={otherMembers}
                />
              );
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={styles.listContent}
          />
        )}

        {showAttachments ? (
          <View style={styles.attachmentBar}>
            <AttachmentButton
              icon="image"
              label="Photo"
              onPress={() => pickImage('library')}
            />
            <AttachmentButton
              icon="camera"
              label="Camera"
              onPress={() => pickImage('camera')}
            />
            <AttachmentButton
              icon="file-text"
              label="Document"
              onPress={pickDocument}
            />
          </View>
        ) : null}

        <View style={[styles.inputBar, { paddingBottom: bottomPadding + 8 }]}>
          {typingText ? (
            <View style={styles.typingBar}>
              <Text style={styles.typingText}>{typingText}</Text>
            </View>
          ) : null}
          <Pressable
            onPress={() => setShowAttachments((s) => !s)}
            style={styles.attachBtn}
          >
            <Feather
              name={showAttachments ? 'x' : 'paperclip'}
              size={22}
              color={C.textSecondary}
            />
          </Pressable>
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            placeholder="Message…"
            placeholderTextColor={C.textTertiary}
            value={inputText}
            onChangeText={handleInputChange}
            multiline
            maxLength={2000}
            returnKeyType="default"
          />
          <Pressable
            onPress={toggleRecording}
            disabled={sendingMedia}
            style={({ pressed }) => [
              styles.micBtn,
              recording && styles.micBtnRecording,
              pressed && styles.sendBtnPressed,
            ]}
          >
            <Feather name={recording ? 'square' : 'mic'} size={20} color="#fff" />
          </Pressable>
          <Pressable
            onPress={handleSend}
            disabled={!inputText.trim() || isSending || sendingMedia}
            style={({ pressed }) => [
              styles.sendBtn,
              (!inputText.trim() || isSending || sendingMedia) && styles.sendBtnDisabled,
              pressed && styles.sendBtnPressed,
            ]}
          >
            {isSending || sendingMedia ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="send" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function AttachmentButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.attachmentBtn}>
      <View style={styles.attachmentIcon}>
        <Feather name={icon} size={22} color="#fff" />
      </View>
      <Text style={styles.attachmentLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: C.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 6,
  },
  backBtn: { padding: 6 },
  headerMeta: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, justifyContent: 'center' },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitial: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
  },
  headerName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  headerAction: { padding: 8 },
  menuBtn: { padding: 8 },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: {
    padding: 12,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },

  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 3,
    paddingHorizontal: 4,
  },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 4,
  },
  bubbleSent: {
    backgroundColor: C.bubbleSent,
    borderBottomRightRadius: 4,
  },
  bubbleReceived: {
    backgroundColor: C.bubbleReceived,
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
    marginBottom: 2,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.bubbleReceivedText,
    lineHeight: 21,
  },
  bubbleTextMine: { color: C.bubbleSentText },
  bubbleTime: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.65)' },
  bubbleTimeOther: { color: C.textTertiary },

  mediaImage: {
    width: 220,
    height: 160,
    borderRadius: 12,
    marginVertical: 4,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  voiceText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: C.text,
  },
  voiceTextMine: { color: '#fff' },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  documentInfo: { flexShrink: 1 },
  documentName: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.text,
  },
  documentNameMine: { color: '#fff' },
  documentMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  documentMetaMine: { color: 'rgba(255,255,255,0.7)' },

  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: 60,
  },
  emptyChatText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.textSecondary,
  },
  emptyChatSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textTertiary,
  },

  attachmentBar: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  attachmentBtn: { alignItems: 'center', gap: 6 },
  attachmentIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.textSecondary,
  },

  typingBar: {
    position: 'absolute',
    top: -22,
    left: 12,
  },
  typingText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.textSecondary,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.tabBar,
    gap: 8,
  },
  attachBtn: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: C.surfaceElevated,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: C.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnRecording: { backgroundColor: C.accent },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: C.surface },
  sendBtnPressed: { opacity: 0.75 },
});
