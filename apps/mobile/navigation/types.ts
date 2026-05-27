export type ConsentType =
  | 'kvkk_aydinlatma'
  | 'saglik_veri'
  | 'ai_transfer'
  | 'chat_history'
  | 'age_18';

export type PendingConsent = {
  consent_type: ConsentType;
  consent_given: boolean;
  version: 'v1.0';
};

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  Otp: { email: string; pendingConsents?: PendingConsent[] };
};

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  Nearby: undefined;
  Chat: undefined;
  Profile: undefined;
};

export type ConditionCatalogRow = {
  id: string;
  name: string;
  category: string;
};
