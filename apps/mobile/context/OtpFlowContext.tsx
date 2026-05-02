import { createContext, useContext } from 'react';

export type OtpFlowContextValue = {
  /** OTP sonrası session kesinleşince App tarafında profil kapısını yenile */
  onOtpSessionReady: () => Promise<void>;
};

export const OtpFlowContext = createContext<OtpFlowContextValue | null>(null);

export function useOtpFlow() {
  return useContext(OtpFlowContext);
}
