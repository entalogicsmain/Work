// Bundles the Capacitor plugins and supabase-js into www/vendor/native.js and exposes them
// as window.ComebackNative. The app code in www/index.html only talks to this object,
// so the same page runs in a plain browser (web fallbacks) and inside the APK.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';
import { Network } from '@capacitor/network';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { createClient } from '@supabase/supabase-js';

// Local Kotlin plugin (android/app/src/main/java/com/entalogics/comeback/steps). Only exists inside the APK.
const Steps = Capacitor.isNativePlatform() ? registerPlugin('Steps') : null;

window.ComebackNative = {
  isNative: Capacitor.isNativePlatform(),
  Preferences,
  Filesystem,
  Directory,
  Encoding,
  Share,
  LocalNotifications,
  App,
  StatusBar,
  Network,
  Steps,
  Haptics,
  ImpactStyle,
  NotificationType,
  createClient
};
