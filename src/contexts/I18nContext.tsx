import React, { createContext, useContext, useCallback, useMemo, useState } from 'react';
import { NativeModules, Platform } from 'react-native';

type Locale = 'en' | 'es' | 'fr' | 'de';

interface Translations {
  [key: string]: string;
}

const translations: Record<Locale, Translations> = {
  en: {
    // Common
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.retry': 'Retry',

    // Profile
    'profile.title': 'Profile',
    'profile.displayName': 'Display Name',
    'profile.email': 'Email',
    'profile.memberSince': 'Member since',
    'profile.editProfile': 'Edit Profile',
    'profile.signOut': 'Sign Out',
    'profile.deleteAccount': 'Delete Account',

    // Settings
    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.notifications': 'Notifications',
    'settings.privacy': 'Privacy',
    'settings.language': 'Language',

    // Home
    'home.welcome': 'Welcome',
    'home.recentActivity': 'Recent Activity',

    // Tasks
    'tasks.title': 'Tasks',
    'tasks.upcoming': 'Upcoming',
    'tasks.completed': 'Completed',
    'tasks.overdue': 'Overdue',

    // Reports
    'reports.title': 'Reports',
    'reports.newReport': 'New Report',
  },
  es: {
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Eliminar',
    'common.edit': 'Editar',
    'common.loading': 'Cargando...',
    'common.error': 'Error',
    'common.success': 'Éxito',
    'common.retry': 'Reintentar',
    'profile.title': 'Perfil',
    'profile.displayName': 'Nombre',
    'profile.email': 'Correo electrónico',
    'profile.memberSince': 'Miembro desde',
    'profile.editProfile': 'Editar perfil',
    'profile.signOut': 'Cerrar sesión',
    'profile.deleteAccount': 'Eliminar cuenta',
    'settings.title': 'Configuración',
    'settings.appearance': 'Apariencia',
    'settings.notifications': 'Notificaciones',
    'settings.privacy': 'Privacidad',
    'settings.language': 'Idioma',
    'home.welcome': 'Bienvenido',
    'home.recentActivity': 'Actividad reciente',
    'tasks.title': 'Tareas',
    'tasks.upcoming': 'Próximas',
    'tasks.completed': 'Completadas',
    'tasks.overdue': 'Vencidas',
    'reports.title': 'Informes',
    'reports.newReport': 'Nuevo informe',
  },
  fr: {
    'common.save': 'Enregistrer',
    'common.cancel': 'Annuler',
    'common.delete': 'Supprimer',
    'common.edit': 'Modifier',
    'common.loading': 'Chargement...',
    'common.error': 'Erreur',
    'common.success': 'Succès',
    'common.retry': 'Réessayer',
    'profile.title': 'Profil',
    'profile.displayName': 'Nom',
    'profile.email': 'E-mail',
    'profile.memberSince': 'Membre depuis',
    'profile.editProfile': 'Modifier le profil',
    'profile.signOut': 'Se déconnecter',
    'profile.deleteAccount': 'Supprimer le compte',
    'settings.title': 'Paramètres',
    'settings.appearance': 'Apparence',
    'settings.notifications': 'Notifications',
    'settings.privacy': 'Confidentialité',
    'settings.language': 'Langue',
    'home.welcome': 'Bienvenue',
    'home.recentActivity': 'Activité récente',
    'tasks.title': 'Tâches',
    'tasks.upcoming': 'À venir',
    'tasks.completed': 'Terminées',
    'tasks.overdue': 'En retard',
    'reports.title': 'Rapports',
    'reports.newReport': 'Nouveau rapport',
  },
  de: {
    'common.save': 'Speichern',
    'common.cancel': 'Abbrechen',
    'common.delete': 'Löschen',
    'common.edit': 'Bearbeiten',
    'common.loading': 'Laden...',
    'common.error': 'Fehler',
    'common.success': 'Erfolg',
    'common.retry': 'Wiederholen',
    'profile.title': 'Profil',
    'profile.displayName': 'Anzeigename',
    'profile.email': 'E-Mail',
    'profile.memberSince': 'Mitglied seit',
    'profile.editProfile': 'Profil bearbeiten',
    'profile.signOut': 'Abmelden',
    'profile.deleteAccount': 'Konto löschen',
    'settings.title': 'Einstellungen',
    'settings.appearance': 'Erscheinungsbild',
    'settings.notifications': 'Benachrichtigungen',
    'settings.privacy': 'Datenschutz',
    'settings.language': 'Sprache',
    'home.welcome': 'Willkommen',
    'home.recentActivity': 'Letzte Aktivität',
    'tasks.title': 'Aufgaben',
    'tasks.upcoming': 'Bevorstehend',
    'tasks.completed': 'Abgeschlossen',
    'tasks.overdue': 'Überfällig',
    'reports.title': 'Berichte',
    'reports.newReport': 'Neuer Bericht',
  },
};

function getDeviceLocale(): Locale {
  let locale = 'en';

  try {
    if (Platform.OS === 'ios') {
      locale = NativeModules.SettingsManager?.settings?.AppleLocale ||
               NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ||
               'en';
    } else {
      locale = NativeModules.I18nManager?.localeIdentifier || 'en';
    }
  } catch {
    locale = 'en';
  }

  const shortLocale = locale.substring(0, 2).toLowerCase();
  return (shortLocale in translations ? shortLocale : 'en') as Locale;
}

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  availableLocales: { code: Locale; name: string }[];
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getDeviceLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    let text = translations[locale]?.[key] || translations.en[key] || key;

    if (params) {
      Object.entries(params).forEach(([paramKey, paramValue]) => {
        text = text.replace(`{{${paramKey}}}`, String(paramValue));
      });
    }

    return text;
  }, [locale]);

  const availableLocales = useMemo(() => [
    { code: 'en' as Locale, name: 'English' },
    { code: 'es' as Locale, name: 'Español' },
    { code: 'fr' as Locale, name: 'Français' },
    { code: 'de' as Locale, name: 'Deutsch' },
  ], []);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      availableLocales,
    }),
    [locale, setLocale, t, availableLocales]
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
