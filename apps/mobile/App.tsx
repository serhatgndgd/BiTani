import 'react-native-gesture-handler';

import type { Session } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ChatScreen from './screens/ChatScreen';
import HomeScreen from './screens/HomeScreen';
import LoginScreen from './screens/LoginScreen';
import NearbyScreen from './screens/NearbyScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import WelcomeScreen from './screens/WelcomeScreen';
import OtpScreen from './screens/OtpScreen';
import ProfileScreen from './screens/ProfileScreen';
import RegisterScreen from './screens/RegisterScreen';
import SearchScreen from './screens/SearchScreen';
import { OtpFlowContext } from './context/OtpFlowContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { supabase } from './lib/supabase';
import type { ThemeColors } from './theme';
import type { AuthStackParamList } from './navigation/types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTabs = createBottomTabNavigator();

function SignOutButton({ C, styles }: { C: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  return (
    <Pressable onPress={() => supabase.auth.signOut()} style={styles.signOutBtn}>
      <Text style={styles.signOutText}>Çıkış</Text>
    </Pressable>
  );
}

function AuthNavigator({ C }: { C: ThemeColors }) {
  return (
    <AuthStack.Navigator
      id="AuthStack"
      initialRouteName="Welcome"
      screenOptions={{
        headerStyle:      { backgroundColor: C.bg },
        headerTintColor:  C.text1,
        headerTitleStyle: { color: C.text1 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: C.bg },
      }}
    >
      <AuthStack.Screen
        name="Welcome"
        component={WelcomeScreen}
        options={{ headerShown: false }}
      />
      <AuthStack.Screen
        name="Login"
        component={LoginScreen}
        options={{
          title: 'Giriş Yap',
          headerBackTitle: '',
        }}
      />
      <AuthStack.Screen
        name="Register"
        component={RegisterScreen}
        options={{
          title: 'Kayıt Ol',
          headerBackTitle: '',
        }}
      />
      <AuthStack.Screen
        name="Otp"
        component={OtpScreen}
        options={{ title: 'E-posta doğrulama' }}
      />
    </AuthStack.Navigator>
  );
}

function MainNavigator({ C, styles }: { C: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  return (
    <MainTabs.Navigator
      id="MainTabs"
      screenOptions={{
        tabBarStyle: {
          backgroundColor: C.bg,
          borderTopColor:  C.border,
        },
        tabBarActiveTintColor:   C.text1,
        tabBarInactiveTintColor: C.text2,
        headerStyle:      { backgroundColor: C.bg },
        headerTintColor:  C.text1,
        headerTitleStyle: { color: C.text1 },
        headerShadowVisible: false,
      }}
    >
      <MainTabs.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Ana Sayfa',
          tabBarLabel: 'Ana Sayfa',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <MainTabs.Screen
        name="Search"
        component={SearchScreen}
        options={{
          title: 'İlaç Ara',
          tabBarLabel: 'İlaç Ara',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" size={size} color={color} />
          ),
        }}
      />
      <MainTabs.Screen
        name="Nearby"
        component={NearbyScreen}
        options={{
          title: 'Yakın Yerler',
          tabBarLabel: 'Yakın',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="location-outline" size={size} color={color} />
          ),
        }}
      />
      <MainTabs.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          title: 'Asistan',
          tabBarLabel: 'Asistan',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses-outline" size={size} color={color} />
          ),
        }}
      />
      <MainTabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Profil',
          tabBarLabel: 'Profil',
          headerRight: () => <SignOutButton C={C} styles={styles} />,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </MainTabs.Navigator>
  );
}

// ─── Biyometrik kilit ekranı ──────────────────────────────────────────────────

interface BiometricGateProps {
  onRetry: () => void;
  C: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}

function BiometricGate({ onRetry, C, styles }: BiometricGateProps) {
  return (
    <View style={styles.biometricGate}>
      <View style={styles.biometricIcon}>
        <Ionicons name="finger-print-outline" size={58} color={C.primary} />
      </View>
      <Text style={styles.biometricTitle}>BiTanı</Text>
      <Text style={styles.biometricSub}>
        Sağlık verilerinizi korumak için{'\n'}kimliğinizi doğrulayın.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.biometricBtn, pressed && { opacity: 0.8 }]}
        onPress={onRetry}
      >
        <Ionicons name="finger-print-outline" size={18} color={C.text1} />
        <Text style={styles.biometricBtnText}>Tekrar Dene</Text>
      </Pressable>
    </View>
  );
}

// ─── Ana uygulama ─────────────────────────────────────────────────────────────

/**
 * Auth akışı:
 * - Oturum yok → Welcome (Auth stack)
 * - Oturum var + onboarding_completed false → Onboarding
 * - Oturum var + onboarding_completed true → Biometric gate → MainTabs
 *
 * Biometric akışı:
 * - Donanım/kayıt yok → doğrudan geç
 * - Face ID / Touch ID başarılı → MainTabs
 * - İptal/başarısız → BiometricGate (tekrar dene)
 */
function AppContent() {
  const { colors: C, isDark } = useTheme();
  const styles = useMemo(() => createStyles(C), [C]);
  const navigationTheme = useMemo(() => {
    const baseTheme = isDark ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: C.bg,
        card:       C.bg,
        primary:    C.primary,
        text:       C.text1,
        border:     C.border,
      },
    };
  }, [C, isDark]);

  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  // Biyometrik durum: null=henüz kontrol edilmedi, checking=doğrulanıyor
  const [biometricPassed, setBiometricPassed] = useState(false);
  const [biometricChecking, setBiometricChecking] = useState(false);

  // ─── Profil kapı kontrolü ────────────────────────────────────────────────

  const refreshProfileGate = useCallback(async (userId: string) => {
    setNeedsOnboarding(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('Profile fetch error:', error.message);
      setNeedsOnboarding(true);
      return;
    }

    if (!data) {
      setNeedsOnboarding(true);
      return;
    }
    setNeedsOnboarding(data.onboarding_completed !== true);
  }, []);

  const onOtpSessionReady = useCallback(async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.id) return;
    await refreshProfileGate(user.id);
  }, [refreshProfileGate]);

  // ─── Session ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data: { session: initial } }) => {
      if (cancelled) return;
      setSession(initial ?? null);
      setSessionReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setNeedsOnboarding(null);
      return;
    }
    void refreshProfileGate(uid);
  }, [session, refreshProfileGate]);

  // ─── Biyometrik auth ─────────────────────────────────────────────────────

  const promptBiometric = useCallback(async () => {
    setBiometricChecking(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !enrolled) {
        // Desteklenmiyor veya kayıtlı değil → doğrudan geç
        setBiometricPassed(true);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'BiTanı sağlık verilerinizi korur',
        cancelLabel: 'İptal',
        disableDeviceFallback: false,
      });
      setBiometricPassed(result.success);
    } catch (error) {
      console.error('biometric-auth:', error);
      setBiometricPassed(false);
    } finally {
      setBiometricChecking(false);
    }
  }, []);

  // showMain her true olduğunda biyometriği tetikle, oturum kapanınca sıfırla
  const signedIn = !!session;
  const profileLoading = signedIn && needsOnboarding === null;
  const showOnboarding = signedIn && needsOnboarding === true;
  const showMain = signedIn && needsOnboarding === false;

  useEffect(() => {
    if (!showMain) {
      setBiometricPassed(false);
      setBiometricChecking(false);
      return;
    }
    void promptBiometric();
  }, [showMain, promptBiometric]);

  // ─── Yükleniyor ───────────────────────────────────────────────────────────

  const showSplash = !sessionReady || profileLoading || (showMain && biometricChecking);

  if (showSplash) {
    return (
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <View style={styles.boot}>
            <ActivityIndicator size="large" color={C.text1} />
          </View>
          <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.bg} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Biyometrik kapı (sadece showMain + geçilmedi + kontrol bitti)
  if (showMain && !biometricPassed) {
    return (
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <BiometricGate C={C} styles={styles} onRetry={() => void promptBiometric()} />
          <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.bg} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // ─── Ana render ───────────────────────────────────────────────────────────

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <OtpFlowContext.Provider value={{ onOtpSessionReady }}>
          {showOnboarding ? (
            <OnboardingScreen
              onComplete={async () => {
                const { data: { user } } = await supabase.auth.getUser();
                if (user?.id) await refreshProfileGate(user.id);
              }}
            />
          ) : (
            <NavigationContainer theme={navigationTheme}>
              {showMain ? <MainNavigator C={C} styles={styles} /> : <AuthNavigator C={C} />}
            </NavigationContainer>
          )}
        </OtpFlowContext.Provider>
        <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.bg} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

function createStyles(C: ThemeColors) {
  return StyleSheet.create({
  flex: { flex: 1 },

  boot: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  signOutBtn:  { marginRight: 16 },
  signOutText: { color: C.error, fontSize: 16 },

  /* Biyometrik kapı */
  biometricGate: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },
  biometricIcon: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: C.primaryDim,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: C.primaryDim,
  },
  biometricTitle: {
    color: C.text1,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  biometricSub: {
    color: C.text3,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  biometricBtnText: {
    color: C.text1,
    fontSize: 15,
    fontWeight: '600',
  },
});
}
