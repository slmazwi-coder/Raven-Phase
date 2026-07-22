import { Stack } from 'expo-router';
import colors from '@/constants/colors';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.light.background },
        animation: 'slide_from_right',
      }}
    />
  );
}
