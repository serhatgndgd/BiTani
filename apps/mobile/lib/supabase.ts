import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SECURE_STORE_CHUNK_SIZE = 1800;

function safeStoreKey(key: string): string {
  const normalized = key.replace(/[^A-Za-z0-9._-]/g, '_');
  return normalized.length > 0 ? normalized : 'supabase_key';
}

const chunkCountKey = (key: string) => `${safeStoreKey(key)}.chunks`;
const chunkKey = (key: string, index: number) => `${safeStoreKey(key)}.chunk.${index}`;

const ExpoSecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    const chunkCountValue = await SecureStore.getItemAsync(chunkCountKey(key));
    const chunkCount = Number.parseInt(chunkCountValue ?? '', 10);

    if (Number.isFinite(chunkCount) && chunkCount > 0) {
      const chunks = await Promise.all(
        Array.from({ length: chunkCount }, (_, index) =>
          SecureStore.getItemAsync(chunkKey(key, index)),
        ),
      );
      return chunks.every((chunk): chunk is string => chunk !== null) ? chunks.join('') : null;
    }

    return SecureStore.getItemAsync(safeStoreKey(key));
  },

  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);

    if (value.length <= SECURE_STORE_CHUNK_SIZE) {
      await SecureStore.setItemAsync(safeStoreKey(key), value);
      return;
    }

    const chunks = Array.from(
      { length: Math.ceil(value.length / SECURE_STORE_CHUNK_SIZE) },
      (_, index) =>
        value.slice(
          index * SECURE_STORE_CHUNK_SIZE,
          (index + 1) * SECURE_STORE_CHUNK_SIZE,
        ),
    );
    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
    );
    await SecureStore.setItemAsync(chunkCountKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const chunkCountValue = await SecureStore.getItemAsync(chunkCountKey(key));
    const chunkCount = Number.parseInt(chunkCountValue ?? '', 10);

    await SecureStore.deleteItemAsync(safeStoreKey(key));
    if (Number.isFinite(chunkCount) && chunkCount > 0) {
      await Promise.all(
        Array.from({ length: chunkCount }, (_, index) =>
          SecureStore.deleteItemAsync(chunkKey(key, index)),
        ),
      );
    }
    await SecureStore.deleteItemAsync(chunkCountKey(key));
  },
};

if (!supabaseUrl) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL');
}

if (!supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
