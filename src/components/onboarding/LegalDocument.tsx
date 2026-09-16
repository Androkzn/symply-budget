import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import {
  getLegalContent,
  LEGAL_CONTACT_DOMAIN,
  LEGAL_ENTITY,
} from '@config/brandContent';
import { useAppColors } from '@theme';

/**
 * Brand-aware legal documents (Terms of Service + Privacy Policy) rendered
 * through a single shared UI. Section BODIES are shared boilerplate; the
 * per-brand bits (service description, collected-data items) come from
 * `@config/brandContent`, and the app name is injected by the caller from
 * `ENV.APP_NAME`. Used by both the onboarding agreement sheets
 * (LegalAgreement) and the settings screens (Terms/PrivacyPolicy screens), so
 * every app gets its own content without forking the UI.
 */

export interface LegalSectionData {
  title: string;
  body: string;
}

const bullets = (items: string[]): string => items.map((i) => `• ${i}`).join('\n');

export function buildTermsSections(appName: string, brandId: string): LegalSectionData[] {
  const { serviceDescription } = getLegalContent(brandId);
  return [
    {
      title: '1. Acceptance of Terms',
      body: `By accessing or using ${appName} ("the App"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the App.`,
    },
    {
      title: '2. Description of Service',
      body: `${appName} ${serviceDescription}`,
    },
    {
      title: '3. User Accounts',
      body: bullets([
        'You must provide accurate and complete information when creating an account.',
        'You are responsible for maintaining the confidentiality of your account credentials.',
        'You must notify us immediately of any unauthorized use of your account.',
        'You must be at least 18 years old to use this service.',
      ]),
    },
    {
      title: '4. User Content',
      body: bullets([
        'You retain ownership of all content you upload to the App.',
        'By uploading content, you grant us a license to process, store, and analyze it for providing our services.',
        'You are responsible for ensuring you have the right to upload any content.',
        'We may remove content that violates these terms.',
      ]),
    },
    {
      title: '5. Prohibited Uses',
      body: `You agree not to:\n${bullets([
        'Use the App for any illegal purpose',
        'Upload malicious software or harmful content',
        'Attempt to gain unauthorized access to our systems',
        "Interfere with other users' use of the App",
        'Violate any applicable laws or regulations',
      ])}`,
    },
    {
      title: '6. AI-Generated Content',
      body: 'The App uses artificial intelligence to analyze your information and generate recommendations. While we strive for accuracy, AI-generated content is provided for informational purposes only and should not be considered professional advice. Always consult a qualified professional before making important decisions.',
    },
    {
      title: '7. Subscription and Payments',
      body: bullets([
        'Some features may require a paid subscription.',
        'Subscription fees are billed according to your chosen plan.',
        'You may cancel your subscription at any time.',
        'Refunds are provided according to our refund policy.',
      ]),
    },
    {
      title: '8. Limitation of Liability',
      body: `To the maximum extent permitted by law, ${LEGAL_ENTITY} shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the App.`,
    },
    {
      title: '9. Changes to Terms',
      body: 'We reserve the right to modify these terms at any time. We will notify users of significant changes via email or in-app notification. Continued use of the App after changes constitutes acceptance of the new terms.',
    },
    {
      title: '10. Contact Us',
      body: `If you have questions about these Terms of Service, please contact us at:\n\nEmail: legal@${LEGAL_CONTACT_DOMAIN}\nWebsite: https://${LEGAL_CONTACT_DOMAIN}/contact`,
    },
  ];
}

export function buildPrivacySections(appName: string, brandId: string): LegalSectionData[] {
  const { dataItems } = getLegalContent(brandId);
  return [
    {
      title: '1. Information We Collect',
      body: `When you use ${appName}, we collect information you provide directly, including:\n${bullets([
        'Account information (name, email, password)',
        ...dataItems,
        'Usage data and app interactions',
      ])}`,
    },
    {
      title: '2. How We Use Your Information',
      body: `We use your information to:\n${bullets([
        'Provide and improve our services',
        'Process and analyze the content you provide',
        'Generate personalized recommendations',
        'Send service-related communications',
        'Ensure security and prevent fraud',
      ])}`,
    },
    {
      title: '3. AI Processing',
      body: 'Content you provide may be processed by AI systems to generate insights. This processing is automated and designed to help you get more out of the App. We do not use your personal content to train AI models without your explicit consent.',
    },
    {
      title: '4. Data Storage and Security',
      body: bullets([
        'Your data is stored securely using industry-standard encryption',
        'We use secure cloud infrastructure to protect your information',
        'Access to your data is restricted to authorized personnel only',
        'We regularly audit our security practices',
      ]),
    },
    {
      title: '5. Data Sharing',
      body: `We do not sell your personal information. We may share data with:\n${bullets([
        'Service providers who help operate our app',
        'Legal authorities when required by law',
        'Other parties with your explicit consent',
      ])}`,
    },
    {
      title: '6. Your Rights',
      body: `You have the right to:\n${bullets([
        'Access your personal data',
        'Request correction of inaccurate data',
        'Request deletion of your data',
        'Export your data in a portable format',
        'Opt out of certain data processing',
      ])}`,
    },
    {
      title: '7. Data Retention',
      body: 'We retain your data for as long as your account is active or as needed to provide services. You can request deletion of your account and associated data at any time through the app settings or by contacting us.',
    },
    {
      title: "8. Children's Privacy",
      body: 'Our service is not intended for users under 18 years of age. We do not knowingly collect personal information from children under 18.',
    },
    {
      title: '9. Changes to Privacy Policy',
      body: 'We may update this Privacy Policy periodically. We will notify you of material changes via email or in-app notification before they take effect.',
    },
    {
      title: '10. Contact Us',
      body: `For privacy-related questions or to exercise your rights, contact us at:\n\nEmail: privacy@${LEGAL_CONTACT_DOMAIN}\nWebsite: https://${LEGAL_CONTACT_DOMAIN}/privacy`,
    },
  ];
}

/** Renders a list of legal sections with the app's theme colors. */
export function LegalSections({ sections }: { sections: LegalSectionData[] }) {
  const colors = useAppColors();
  return (
    <>
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            {section.title}
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.sectionText}>
            {section.body}
          </Typography>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  sectionText: {
    marginTop: 8,
    lineHeight: 22,
  },
});
