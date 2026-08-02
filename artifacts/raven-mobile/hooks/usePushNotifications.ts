import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Application from 'expo-application';
import { registerPushToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  const { token, member } = useAuth();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!token || registeredRef.current) return;

    async function setup() {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;

      const pushToken = (await Notifications.getExpoPushTokenAsync()).data;

      let deviceIdentifier: string;
      if (Platform.OS === 'android') {
        deviceIdentifier = await Application.getAndroidId();
      } else {
        deviceIdentifier = (await Application.getIosIdForVendorAsync()) ?? pushToken;
      }

      await registerPushToken(token!, {
        device_identifier: deviceIdentifier,
        platform: Platform.OS as 'ios' | 'android',
        push_token: pushToken,
      });
      registeredRef.current = true;
    }

    setup().catch(() => {
      // Push token registration is best-effort
    });
  }, [token]);
}
