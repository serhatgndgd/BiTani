export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  Otp: { email: string };
};

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  Chat: undefined;
  Profile: undefined;
};

export type ConditionCatalogRow = {
  id: string;
  name: string;
  category: string;
};
