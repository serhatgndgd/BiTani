import 'react-native-gesture-handler';

import type { Session } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ChatScreen from './screens/ChatScreen';
import HomeScreen from './screens/HomeScreen';
import LoginScreen from './screens/LoginScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import WelcomeScreen from './screens/WelcomeScreen';
import OtpScreen from './screens/OtpScreen';
import ProfileScreen from './screens/ProfileScreen';
import RegisterScreen from './screens/RegisterScreen';
import SearchScreen from './screens/SearchScreen';
import { OtpFlowContext } from './context/OtpFlowContext';
import { supabase } from './lib/supabase';
import type { AuthStackParamList } from './navigation/types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTabs = createBottomTabNavigator();

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0a0a0a',
    card: '#0a0a0a',
    primary: '#ffffff',
    text: '#ffffff',
    border: '#222222',
  },
};

function SignOutButton() {
  return (
    <Pressable onPress={() => supabase.auth.signOut()} style={{ marginRight: 16 }}>
      <Text style={{ color: '#ff8a80', fontSize: 16 }}>Çıkış</Text>
    </Pressable>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator
      id="AuthStack"
      initialRouteName="Welcome"
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#fff',
        headerTitleStyle: { color: '#fff' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: '#0a0a0a' },
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
        options={{ title: 'Giriş' }}
      />
      <AuthStack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ title: 'Kayıt' }}
      />
      <AuthStack.Screen
        name="Otp"
        component={OtpScreen}
        options={{ title: 'E-posta doğrulama' }}
      />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  return (
    <MainTabs.Navigator
      id="MainTabs"
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#0a0a0a',
          borderTopColor: '#222',
        },
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: '#888',
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#fff',
        headerTitleStyle: { color: '#fff' },
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
          headerRight: () => <SignOutButton />,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </MainTabs.Navigator>
  );
}

/**
 * Supabase expo-user-management örneğiyle aynı çekirdek:
 * - İlk açılışta getSession()
 * - onAuthStateChange ile oturum güncellemeleri
 * - Oturum netleşene kadar yükleme ekranı
 *
 * BiTanı akışı:
 * - Oturum yok → Welcome (Auth stack)
 * - Oturum var + onboarding_completed false → Onboarding
 * - Oturum var + onboarding_completed true → MainTabs
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  /** İlk getSession() tamamlandı mı (oturum null da olsa “belli”) */
  const [sessionReady, setSessionReady] = useState(false);
  /** null: profil sorgusu sürüyor; true: onboarding gerekli; false: tamamlandı */
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  const refreshProfileGate = useCallback(async (userId: string) => {
    setNeedsOnboarding(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
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

  const signedIn = !!session;
  const profileLoading = signedIn && needsOnboarding === null;
  const showOnboarding = signedIn && needsOnboarding === true;
  const showMain = signedIn && needsOnboarding === false;

  const showSplash = !sessionReady || profileLoading;

  if (showSplash) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={styles.boot}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
          <StatusBar style="light" />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
              {showMain ? <MainNavigator /> : <AuthNavigator />}
            </NavigationContainer>
          )}
        </OtpFlowContext.Provider>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
