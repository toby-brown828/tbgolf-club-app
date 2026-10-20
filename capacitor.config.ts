import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "com.theblacktee.golflounge",
  appName: "Black Tee Golf Lounge",
  webDir: "dist",
  backgroundColor: "#000000",
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    SplashScreen: { backgroundColor: "#000000", showSpinner: false },
  },
}

export default config
