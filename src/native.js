// Bundles the Capacitor plugins and supabase-js into www/vendor/native.js and exposes them
// as window.ResetNative. The app code in www/index.html only talks to this object,
// so the same page runs in a plain browser (web fallbacks) and inside the APK.
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';
import { Network } from '@capacitor/network';
import { createClient } from '@supabase/supabase-js';

window.ResetNative = {
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
  createClient
};
