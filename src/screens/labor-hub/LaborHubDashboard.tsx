import { BlurView } from '@react-native-community/blur';
import { useNavigation, useFocusEffect } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, Animated, Platform, LayoutChangeEvent, TextInput, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  appointmentsApi,
  type AppointmentWithDetails,
  type AppointmentStatus,
  APPOINTMENT_TYPE_INFO,
  APPOINTMENT_STATUS_INFO,
} from '@api/appointments';
import {
  contractorsApi,
  type ContractorWithStats,
  type ContractorSpecialty,
  SPECIALTY_INFO,
  CONTRACTOR_SPECIALTIES,
} from '@api/contractors';
import { floorPlansApi } from '@api/floor-plans';
import {
  projectsApi,
  type ProjectWithDetails,
  type ProjectStatus,
  PROJECT_STATUS_INFO,
} from '@api/projects';
import {
  quotesApi,
  type QuoteWithDetails,
  type QuoteStatus,
  QUOTE_STATUS_INFO,
} from '@api/quotes';
import { AppBackground, ScreenFooterGlass, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, SettingsGearButton } from '@components/common';
import { AdaptiveContainer, AdaptiveGrid } from '@components/layout';
import { Typography, FloatingActionButton, FilterTabs, GradientButton, type FilterTab, StarRating, FavoriteStar } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { ContractorsStackScreenProps } from '@navigation/types';
import { useAppointmentStore } from '@stores/appointmentStore';
import { useFloorPlanStore } from '@stores/floorPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useProjectStore } from '@stores/projectStore';
import { useQuoteStore } from '@stores/quoteStore';
import { Chat as ChatTokens, Spacing, scaledFont, useAppColors } from '@theme';
import { getContractorCategoryIcon, type IoniconName } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { formatMoney, useDisplayCurrency } from '@utils/money';

// Format currency from cents, compactly ("CA$1.2k") in the display currency.
function formatCurrency(cents: number): string {
  return formatMoney(cents, { abbreviate: true });
}

// Format date for display
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow';
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

type ContractorFilterTabId = 'all' | 'favorites' | ContractorSpecialty;
type AppointmentFilterTabId = 'upcoming' | 'all' | AppointmentStatus;
type QuoteFilterTabId = 'pending' | 'all' | QuoteStatus;
type ProjectFilterTabId = 'active' | 'all' | ProjectStatus;

// Format time for display
function formatTime(timeString: string | null): string {
  if (!timeString) return '';
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

// Appointment Card Component
interface AppointmentCardProps {
  appointment: AppointmentWithDetails;
  onPress: () => void;
}

function AppointmentCard({ appointment, onPress }: AppointmentCardProps) {
  const colors = useAppColors();
  const typeInfo = APPOINTMENT_TYPE_INFO[appointment.type] || APPOINTMENT_TYPE_INFO.consultation;
  const statusInfo = APPOINTMENT_STATUS_INFO[appointment.status] || APPOINTMENT_STATUS_INFO.pending;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.groupedListBackground }]}
      onPress={onPress}
      activeOpacity={0.7}
      testID="contractors-appointment-row"
    >
      <View style={styles.cardRow}>
        <View style={[styles.iconCircle, { backgroundColor: typeInfo.color + '20' }]}>
          <Icon name={typeInfo.iconName} size={20} color={typeInfo.color} />
        </View>
        <View style={styles.cardContent}>
          <Typography variant="subheadline" weight="semibold" numberOfLines={1}>
            {appointment.title}
          </Typography>
          <Typography variant="caption1" color="secondary">
            {appointment.contractor.name}
            {appointment.contractor.company_name && ` • ${appointment.contractor.company_name}`}
          </Typography>
          <View style={styles.dateTimeRow}>
            <Typography variant="caption2" weight="medium" style={{ color: typeInfo.color }}>
              {formatDate(appointment.scheduled_date)}
              {appointment.scheduled_time_start && ` at ${formatTime(appointment.scheduled_time_start)}`}
            </Typography>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
          <Typography variant="caption2" weight="medium" style={{ color: statusInfo.color }}>
            {statusInfo.label}
          </Typography>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Quote Card Component
interface QuoteCardProps {
  quote: QuoteWithDetails;
  onPress: () => void;
}

function QuoteCard({ quote, onPress }: QuoteCardProps) {
  const colors = useAppColors();
  const statusInfo = QUOTE_STATUS_INFO[quote.status] || QUOTE_STATUS_INFO.requested;

  const getAmountDisplay = () => {
    if (quote.amount_cents) {
      return formatCurrency(quote.amount_cents);
    }
    if (quote.amount_range_low_cents && quote.amount_range_high_cents) {
      return `${formatCurrency(quote.amount_range_low_cents)} - ${formatCurrency(quote.amount_range_high_cents)}`;
    }
    return 'Pending';
  };

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.groupedListBackground }]}
      onPress={onPress}
      activeOpacity={0.7}
      testID="contractors-quote-row"
    >
      <View style={styles.cardRow}>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: `${colors.orange}2A` },
          ]}
        >
          <Icon name="document-text" size={20} color={colors.orange} />
        </View>
        <View style={styles.cardContent}>
          <Typography variant="subheadline" weight="semibold" numberOfLines={1}>
            {quote.title}
          </Typography>
          <Typography variant="caption1" color="secondary">
            {quote.contractor.name}
          </Typography>
          <Typography variant="headline" weight="bold" style={{ color: colors.primary }}>
            {getAmountDisplay()}
          </Typography>
        </View>
        <View>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
            <Typography variant="caption2" weight="medium" style={{ color: statusInfo.color }}>
              {statusInfo.label}
            </Typography>
          </View>
          {quote.isExpiringSoon && (
            <View style={styles.expiringRow}>
              <Icon name="warning" size={12} color={colors.error} />
              <Typography variant="caption2" color="error">
                Expiring soon
              </Typography>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Project Card Component
interface ProjectCardProps {
  project: ProjectWithDetails;
  onPress: () => void;
  hasFloorPlans: boolean;
  onFloorPlanPress: () => void;
}

function ProjectCard({ project, onPress, hasFloorPlans, onFloorPlanPress }: ProjectCardProps) {
  const colors = useAppColors();
  const { theme } = useTheme();
  const statusInfo = PROJECT_STATUS_INFO[project.status] || PROJECT_STATUS_INFO.planning;
  const progress = project.progress;
  const progressPercent =
    progress.totalMilestones > 0
      ? Math.round((progress.completedMilestones / progress.totalMilestones) * 100)
      : 0;

  return (
    <View style={[styles.projectCard, { backgroundColor: colors.groupedListBackground }]}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        testID="contractors-project-row"
      >
        {/* Home Image Placeholder */}
        <View style={[styles.projectImageContainer, { backgroundColor: colors.backgroundSecondary }]}>
          <Icon name="home" size={34} color={colors.textSecondary} style={{ opacity: 0.3 }} />
          <Typography variant="caption2" color="secondary" style={{ marginTop: 4 }}>
            Home Image
          </Typography>
        </View>

        <View style={styles.projectCardContent}>
          <Typography variant="headline" weight="semibold" numberOfLines={1}>
            {project.title}
          </Typography>
          <Typography variant="subheadline" color="secondary" style={{ marginTop: 2 }}>
            {project.contractor.name}
          </Typography>
          
          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.borderColor }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progressPercent}%`, backgroundColor: statusInfo.color },
                ]}
              />
            </View>
            <Typography variant="caption2" color="secondary" style={{ marginLeft: 8 }}>
              {progressPercent}%
            </Typography>
          </View>
        </View>
      </TouchableOpacity>

      {/* Floor Plan Button */}
      <TouchableOpacity
        style={[
          styles.floorPlanButton,
          { 
            backgroundColor: hasFloorPlans ? theme.pastel.teal + '15' : colors.backgroundSecondary,
            borderColor: hasFloorPlans ? theme.pastel.teal + '40' : colors.borderColor,
          },
        ]}
        onPress={onFloorPlanPress}
        activeOpacity={0.7}
      >
        <Icon
          name={hasFloorPlans ? 'grid' : 'add'}
          size={16}
          color={hasFloorPlans ? theme.pastel.teal : colors.primary}
          style={{ marginRight: 6 }}
        />
        <Typography
          variant="caption1"
          weight="medium"
          style={{ color: hasFloorPlans ? theme.pastel.teal : colors.primary }}
        >
          {hasFloorPlans ? 'Floor Plan' : 'Add Floor Plan'}
        </Typography>
      </TouchableOpacity>
    </View>
  );
}

// Contractor Card Component for Labor Hub
interface ContractorCardCompactProps {
  contractor: ContractorWithStats;
  onPress: () => void;
  onFavoriteToggle: () => void;
}

function ContractorCardCompact({ contractor, onPress, onFavoriteToggle }: ContractorCardCompactProps) {
  const { theme } = useTheme();
  const colors = useAppColors();

  const handleCall = () => {
    if (contractor.phone) {
      Linking.openURL(`tel:${contractor.phone}`);
    }
  };

  const handleEmail = () => {
    if (contractor.email) {
      Linking.openURL(`mailto:${contractor.email}`);
    }
  };

  const handleWebsite = () => {
    if (contractor.website) {
      const url = contractor.website.startsWith('http') 
        ? contractor.website 
        : `https://${contractor.website}`;
      Linking.openURL(url);
    }
  };

  const hasContactOptions = contractor.phone || contractor.email || contractor.website;

  return (
    <View style={[styles.contractorCard, { backgroundColor: colors.backgroundSecondary }]}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        testID="contractors-row"
      >
        <View style={styles.contractorCardHeader}>
          <View
            style={[
              styles.specialtyBadge,
              { backgroundColor: contractor.specialtyInfo.color + '20' },
            ]}
          >
            <Icon
              name={getContractorCategoryIcon(contractor.specialty)}
              size={14}
              color={contractor.specialtyInfo.color}
            />
            <Typography
              variant="caption2"
              weight="medium"
              style={{ color: contractor.specialtyInfo.color, marginLeft: 4 }}
            >
              {contractor.specialtyInfo.label}
            </Typography>
          </View>
          <View style={styles.favoriteButton}>
            <FavoriteStar isFavorite={contractor.is_favorite} onToggle={onFavoriteToggle} />
          </View>
        </View>

        <View style={styles.contractorCardBody}>
          <Typography variant="headline" weight="semibold" numberOfLines={1}>
            {contractor.name}
          </Typography>
          {contractor.company_name && (
            <Typography variant="subheadline" color={colors.textSecondary} numberOfLines={1}>
              {contractor.company_name}
            </Typography>
          )}
          <StarRating rating={contractor.rating} />
        </View>

        <View
          style={[styles.contractorCardStats, { borderTopColor: colors.divider }]}
        >
          <View style={styles.statItem}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Visits
            </Typography>
            <Typography variant="subheadline" weight="semibold">
              {contractor.totalVisits}
            </Typography>
          </View>
          <View style={styles.statItem}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Total Spent
            </Typography>
            <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
              {formatCurrency(contractor.totalSpent)}
            </Typography>
          </View>
          {contractor.lastVisitDate && (
            <View style={styles.statItem}>
              <Typography variant="caption1" color={colors.textSecondary}>
                Last Visit
              </Typography>
              <Typography variant="subheadline" weight="medium">
                {new Date(contractor.lastVisitDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </Typography>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {hasContactOptions && (
        <View style={[styles.contactButtonsRow, { borderColor: colors.borderColor }]}>
          {contractor.phone && (
            <TouchableOpacity
              style={styles.contactButton}
              onPress={handleCall}
              activeOpacity={0.6}
            >
              <Icon name="call" size={16} color={theme.pastel.teal} />
              <Typography variant="subheadline" color={theme.pastel.teal} style={styles.contactButtonLabel}>
                Call
              </Typography>
            </TouchableOpacity>
          )}
          {contractor.email && (
            <TouchableOpacity
              style={styles.contactButton}
              onPress={handleEmail}
              activeOpacity={0.6}
            >
              <Icon name="mail" size={16} color={theme.pastel.teal} />
              <Typography variant="subheadline" color={theme.pastel.teal} style={styles.contactButtonLabel}>
                Email
              </Typography>
            </TouchableOpacity>
          )}
          {contractor.website && (
            <TouchableOpacity
              style={styles.contactButton}
              onPress={handleWebsite}
              activeOpacity={0.6}
            >
              <Icon name="globe" size={16} color={theme.pastel.teal} />
              <Typography variant="subheadline" color={theme.pastel.teal} style={styles.contactButtonLabel}>
                Web
              </Typography>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// Tab types for quick actions
type QuickActionTabType = 'upcoming' | 'quotes' | 'contractors' | 'projects';

// iOS 26 Style Quick Action Tabs Container
interface QuickActionTabsProps {
  activeTab: QuickActionTabType;
  onTabChange: (tab: QuickActionTabType) => void;
}

const QUICK_ACTION_TABS: {
  id: QuickActionTabType;
  icon: IoniconName;
  label: string;
  colorKey: 'blue' | 'orange' | 'purple' | 'green';
}[] = [
  { id: 'upcoming', icon: 'calendar', label: 'Schedule', colorKey: 'blue' },
  { id: 'quotes', icon: 'document-text', label: 'Quotes', colorKey: 'orange' },
  { id: 'contractors', icon: 'construct', label: 'Contractors', colorKey: 'purple' },
  { id: 'projects', icon: 'hammer', label: 'Projects', colorKey: 'green' },
];

function QuickActionTabs({ activeTab, onTabChange }: QuickActionTabsProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const activeIndex = QUICK_ACTION_TABS.findIndex(tab => tab.id === activeTab);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleAnims = useRef(QUICK_ACTION_TABS.map(() => new Animated.Value(1))).current;
  const [containerWidth, setContainerWidth] = useState(0);

  // Calculate tab width
  const tabWidth =
    containerWidth > 0
      ? (containerWidth - Spacing.base * 2) / QUICK_ACTION_TABS.length
      : 0;

  // Animate the sliding indicator with iOS 26 fluid spring
  useEffect(() => {
    if (containerWidth > 0) {
      Animated.spring(slideAnim, {
        toValue: activeIndex * tabWidth,
        useNativeDriver: true,
        tension: 100,
        friction: 12,
      }).start();
    }
  }, [activeIndex, slideAnim, tabWidth, containerWidth]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  const handleTabPress = (tabId: QuickActionTabType, index: number) => {
    // Scale animation on press
    Animated.sequence([
      Animated.timing(scaleAnims[index], {
        toValue: 0.92,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnims[index], {
        toValue: 1,
        useNativeDriver: true,
        tension: 400,
        friction: 12,
      }),
    ]).start();

    onTabChange(tabId);
  };

  return (
    <View style={styles.quickActionsOuter}>
      {/* iOS 26 liquid glass background */}
      <View style={styles.quickActionsBlur}>
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType="xlight"
          blurAmount={25}
          reducedTransparencyFallbackColor="rgba(255, 255, 255, 0.95)"
        />
        <View
          style={[
            styles.quickActionsOverlay,
            {
              backgroundColor: theme.dark
                ? 'rgba(255, 255, 255, 0.14)'
                : 'rgba(255, 255, 255, 0.6)',
            },
          ]}
        />
        <View
          style={[
            styles.quickActionsShine,
            {
              backgroundColor: theme.dark
                ? 'rgba(255, 255, 255, 0.08)'
                : 'rgba(255, 255, 255, 0.2)',
            },
          ]}
        />
      </View>

      <View style={styles.quickActionsContainer} onLayout={handleLayout}>
        {/* Sliding pill indicator */}
        {containerWidth > 0 && (
          <Animated.View
            style={[
              styles.quickActionSlider,
              {
                width: tabWidth,
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            <View
              style={[
                styles.quickActionSliderInner,
                {
                  backgroundColor: theme.pastel.teal + '20',
                  borderColor: theme.pastel.teal + '40',
                  shadowColor: colors.black,
                },
              ]}
            >
              {/* Inner tint based on teal color */}
              <View
                style={[
                  styles.quickActionSliderTint,
                  { backgroundColor: theme.pastel.teal + '15' },
                ]}
              />
            </View>
          </Animated.View>
        )}

        {/* Tab buttons */}
        {QUICK_ACTION_TABS.map((tab, index) => {
          const isActive = tab.id === activeTab;
          const tabAccent = colors[tab.colorKey];
          return (
            <Animated.View
              key={tab.id}
              style={[
                styles.quickActionWrapper,
                { transform: [{ scale: scaleAnims[index] }] },
              ]}
            >
              <TouchableOpacity
                style={styles.quickAction}
                onPress={() => handleTabPress(tab.id, index)}
                activeOpacity={0.7}
                testID={`contractors-tab-${tab.id}`}
              >
                <View
                  style={[
                    styles.quickActionIcon,
                    {
                      backgroundColor: isActive
                        ? theme.pastel.teal + '25'
                        : tabAccent + '18',
                      borderWidth: isActive ? 2 : 0,
                      borderColor: isActive ? theme.pastel.teal + '40' : 'transparent',
                    },
                  ]}
                >
                  <Icon
                    name={tab.icon}
                    size={20}
                    color={isActive ? theme.pastel.teal : tabAccent}
                  />
                </View>
                <Typography
                  variant="caption2"
                  weight={isActive ? 'bold' : 'semibold'}
                  style={{
                    color: isActive ? theme.pastel.teal : colors.textSecondary,
                    marginTop: ChatTokens.compactGap,
                    letterSpacing: -0.2,
                  }}
                >
                  {tab.label}
                </Typography>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

// Main Dashboard Component
export function LaborHubDashboard() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<ContractorsStackScreenProps<'LaborHubDashboard'>['navigation']>();
  const insets = useSafeAreaInsets();
  const { isTablet, isLandscape, columns } = useDeviceType();
  const { cardGap, content: containerPadding } = useLayoutPadding();
  const { currentHousehold } = useHouseholdStore();

  const { setUpcomingAppointments } = useAppointmentStore();

  const { setPendingQuotes } = useQuoteStore();

  const { setActiveProjects } = useProjectStore();

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<QuickActionTabType>('upcoming');

  // Appointments state
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [activeAppointmentFilter, setActiveAppointmentFilter] = useState<AppointmentFilterTabId>('upcoming');

  // Quotes state
  const [quotes, setQuotes] = useState<QuoteWithDetails[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [activeQuoteFilter, setActiveQuoteFilter] = useState<QuoteFilterTabId>('pending');

  // Projects state
  const [projects, setProjects] = useState<ProjectWithDetails[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [activeProjectFilter, setActiveProjectFilter] = useState<ProjectFilterTabId>('active');

  // Contractor state
  const [contractors, setContractors] = useState<ContractorWithStats[]>([]);
  const [contractorsLoading, setContractorsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeContractorFilter, setActiveContractorFilter] = useState<ContractorFilterTabId>('all');

  // Floor plans state
  const { floorPlans, setFloorPlans } = useFloorPlanStore();
  const [floorPlansLoaded, setFloorPlansLoaded] = useState(false);

  const householdId = currentHousehold?.id;

  // Load appointments data
  const loadAppointments = useCallback(async (showLoading = false) => {
    if (!householdId) return;

    try {
      if (showLoading) setAppointmentsLoading(true);

      let data;
      if (activeAppointmentFilter === 'upcoming') {
        data = await appointmentsApi.getUpcoming(householdId, 30);
      } else if (activeAppointmentFilter === 'all') {
        data = await appointmentsApi.getAll(householdId);
      } else {
        data = await appointmentsApi.getAll(householdId, { status: activeAppointmentFilter as AppointmentStatus });
      }
      setAppointments(data.appointments);
      setUpcomingAppointments(data.appointments.filter(a => 
        ['pending', 'confirmed'].includes(a.status)
      ));
    } catch (err) {
      console.error('Error loading appointments:', err);
    } finally {
      if (showLoading) setAppointmentsLoading(false);
      setInitialLoading(false);
    }
  }, [householdId, activeAppointmentFilter, setUpcomingAppointments]);

  // Load quotes data
  const loadQuotes = useCallback(async (showLoading = false) => {
    if (!householdId) return;

    try {
      if (showLoading) setQuotesLoading(true);

      let data;
      if (activeQuoteFilter === 'pending') {
        data = await quotesApi.getPending(householdId);
      } else if (activeQuoteFilter === 'all') {
        data = await quotesApi.getAll(householdId);
      } else {
        data = await quotesApi.getAll(householdId, { status: activeQuoteFilter as QuoteStatus });
      }
      setQuotes(data.quotes);
      setPendingQuotes(data.quotes.filter(q => 
        ['requested', 'received', 'reviewing'].includes(q.status)
      ));
    } catch (err) {
      console.error('Error loading quotes:', err);
    } finally {
      if (showLoading) setQuotesLoading(false);
    }
  }, [householdId, activeQuoteFilter, setPendingQuotes]);

  // Load projects data
  const loadProjects = useCallback(async (showLoading = false) => {
    if (!householdId) return;

    try {
      if (showLoading) setProjectsLoading(true);

      let data;
      if (activeProjectFilter === 'active') {
        data = await projectsApi.getActive(householdId);
      } else if (activeProjectFilter === 'all') {
        data = await projectsApi.getAll(householdId);
      } else {
        data = await projectsApi.getAll(householdId, { status: activeProjectFilter as ProjectStatus });
      }
      setProjects(data.projects);
      setActiveProjects(data.projects.filter(p => 
        ['planning', 'in_progress', 'on_hold'].includes(p.status)
      ));
    } catch (err) {
      console.error('Error loading projects:', err);
    } finally {
      if (showLoading) setProjectsLoading(false);
    }
  }, [householdId, activeProjectFilter, setActiveProjects]);

  // Load contractors data
  const loadContractors = useCallback(async (showLoading = false) => {
    if (!householdId) return;

    try {
      if (showLoading) setContractorsLoading(true);
      const filters: { specialty?: ContractorSpecialty; is_favorite?: boolean; search?: string } = {};

      if (activeContractorFilter === 'favorites') {
        filters.is_favorite = true;
      } else if (activeContractorFilter !== 'all') {
        filters.specialty = activeContractorFilter as ContractorSpecialty;
      }

      if (searchQuery) {
        filters.search = searchQuery;
      }

      const data = await contractorsApi.getAll(householdId, filters);
      setContractors(data.contractors);
    } catch (err) {
      console.error('Error loading contractors:', err);
    } finally {
      if (showLoading) setContractorsLoading(false);
    }
  }, [householdId, activeContractorFilter, searchQuery]);

  // Load floor plans data
  const loadFloorPlans = useCallback(async () => {
    if (!householdId || floorPlansLoaded) return;

    try {
      const data = await floorPlansApi.list(householdId);
      setFloorPlans(data.floor_plans);
      setFloorPlansLoaded(true);
    } catch (err) {
      console.error('Error loading floor plans:', err);
    }
  }, [householdId, floorPlansLoaded, setFloorPlans]);

  // Initial load
  useEffect(() => {
    loadAppointments(true);
  }, [loadAppointments]);

  // Reload data when tab or filter changes
  useEffect(() => {
    if (activeTab === 'upcoming') {
      loadAppointments(appointments.length === 0);
    }
  }, [activeTab, activeAppointmentFilter, loadAppointments, appointments.length]);

  useEffect(() => {
    if (activeTab === 'quotes') {
      loadQuotes(quotes.length === 0);
    }
  }, [activeTab, activeQuoteFilter, loadQuotes, quotes.length]);

  useEffect(() => {
    if (activeTab === 'projects') {
      loadProjects(projects.length === 0);
      loadFloorPlans();
    }
  }, [activeTab, activeProjectFilter, loadProjects, loadFloorPlans, projects.length]);

  useEffect(() => {
    if (activeTab === 'contractors') {
      loadContractors(contractors.length === 0);
    }
  }, [activeTab, activeContractorFilter, searchQuery, loadContractors, contractors.length]);

  // Refresh data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      switch (activeTab) {
        case 'upcoming':
          loadAppointments();
          break;
        case 'quotes':
          loadQuotes();
          break;
        case 'projects':
          loadProjects();
          break;
        case 'contractors':
          loadContractors();
          break;
      }
    }, [activeTab, loadAppointments, loadQuotes, loadProjects, loadContractors])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    switch (activeTab) {
      case 'upcoming':
        await loadAppointments();
        break;
      case 'quotes':
        await loadQuotes();
        break;
      case 'projects':
        await loadProjects();
        break;
      case 'contractors':
        await loadContractors();
        break;
    }
    setRefreshing(false);
  }, [activeTab, loadAppointments, loadQuotes, loadProjects, loadContractors]);

  // Toggle contractor favorite
  const handleToggleFavorite = async (contractor: ContractorWithStats) => {
    if (!householdId) return;

    try {
      await contractorsApi.toggleFavorite(
        householdId,
        contractor.id,
        !contractor.is_favorite
      );
      await loadContractors();
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  };

  // Appointment filter tabs
  const appointmentFilterTabs: FilterTab[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'completed', label: 'Completed' },
  ];

  // Quote filter tabs
  const quoteFilterTabs: FilterTab[] = [
    { id: 'pending', label: 'Pending' },
    { id: 'all', label: 'All' },
    { id: 'requested', label: 'Requested' },
    { id: 'received', label: 'Received' },
    { id: 'accepted', label: 'Accepted' },
    { id: 'declined', label: 'Declined' },
  ];

  // Project filter tabs
  const projectFilterTabs: FilterTab[] = [
    { id: 'active', label: 'Active' },
    { id: 'all', label: 'All' },
    { id: 'planning', label: 'Planning' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'on_hold', label: 'On Hold' },
    { id: 'completed', label: 'Completed' },
  ];

  // Contractor filter tabs
  const contractorFilterTabs: FilterTab[] = [
    { id: 'all', label: 'All' },
    { id: 'favorites', label: 'Favorites', icon: 'star' },
    ...CONTRACTOR_SPECIALTIES.slice(0, 4).map((specialty) => ({
      id: specialty,
      label: SPECIALTY_INFO[specialty].label,
    })),
  ];

  const handleAppointmentPress = (appointment: AppointmentWithDetails) => {
    navigation.navigate('AppointmentDetail', { appointmentId: appointment.id });
  };

  const handleQuotePress = (quote: QuoteWithDetails) => {
    navigation.navigate('QuoteDetail', { quoteId: quote.id });
  };

  const handleProjectPress = (project: ProjectWithDetails) => {
    navigation.navigate('ProjectDetail', { projectId: project.id });
  };

  const handleSeeAllProjects = () => {
    navigation.navigate('Projects');
  };

  // Quick action handlers for "See All" navigation
  const handleAddAppointment = () => {
    navigation.navigate('AddEditAppointment', {});
  };

  const handleRequestQuote = () => {
    navigation.navigate('RequestQuote', {});
  };

  const handleFindContractor = () => {
    navigation.navigate('ContractorSearch');
  };

  const handleAddContractor = () => {
    navigation.navigate('AddEditContractor', {});
  };

  const handleContractorPress = (contractor: ContractorWithStats) => {
    navigation.navigate('ContractorDetail', { contractorId: contractor.id });
  };

  // Floor plan handlers
  const hasFloorPlans = floorPlans.length > 0;

  const handleFloorPlanPress = () => {
    if (hasFloorPlans) {
      // Navigate to first floor plan viewer or floor plans list
      navigation.navigate('Settings', {
        screen: 'FloorPlansMain',
      });
    } else {
      // Navigate to upload new floor plan
      navigation.navigate('Settings', {
        screen: 'FloorPlanUpload',
      });
    }
  };

  if (initialLoading) {
    return (
      <AppBackground>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
      <View testID="contractors-screen" style={{ flex: 1 }}>
        <ScreenHeader
          showBackButton={navigation.canGoBack()}
          onBackPress={() => navigation.goBack()}
          rightElement={<SettingsGearButton />}
        />

        <ScrollView {...keyboardDismissScrollProps}
          style={styles.scrollView}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
        <AdaptiveContainer>
          {/* iOS 26 Style Quick Action Tabs */}
          <QuickActionTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Tab Content */}
          {activeTab === 'upcoming' && (
            <>
              {/* Filter Tabs */}
              <View style={styles.filterWrapper}>
                <FilterTabs
                  tabs={appointmentFilterTabs}
                  activeTab={activeAppointmentFilter}
                  onTabChange={(tabId) => setActiveAppointmentFilter(tabId as AppointmentFilterTabId)}
                  scrollable
                />
              </View>

              {/* Appointments List */}
              {appointmentsLoading ? (
                <View style={styles.listLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : appointments.length === 0 ? (
                <View style={styles.listEmptyState}>
                  <Icon
                    name="calendar"
                    size={40}
                    color={colors.textSecondary}
                    style={{ marginBottom: 8 }}
                  />
                  <Typography variant="headline" weight="semibold" style={{ marginBottom: 4 }}>
                    No appointments found
                  </Typography>
                  <Typography variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
                    Schedule appointments with your contractors to keep track of their visits.
                  </Typography>
                </View>
              ) : (
                appointments.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    onPress={() => handleAppointmentPress(appointment)}
                  />
                ))
              )}
            </>
          )}

          {activeTab === 'quotes' && (
            <>
              {/* Filter Tabs */}
              <View style={styles.filterWrapper}>
                <FilterTabs
                  tabs={quoteFilterTabs}
                  activeTab={activeQuoteFilter}
                  onTabChange={(tabId) => setActiveQuoteFilter(tabId as QuoteFilterTabId)}
                  scrollable
                />
              </View>

              {/* Quotes List */}
              {quotesLoading ? (
                <View style={styles.listLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : quotes.length === 0 ? (
                <View style={styles.listEmptyState}>
                  <Icon
                    name="document-text"
                    size={40}
                    color={colors.textSecondary}
                    style={{ marginBottom: 8 }}
                  />
                  <Typography variant="headline" weight="semibold" style={{ marginBottom: 4 }}>
                    No quotes found
                  </Typography>
                  <Typography variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
                    Request quotes from contractors to compare prices and services.
                  </Typography>
                </View>
              ) : (
                quotes.map((quote) => (
                  <QuoteCard
                    key={quote.id}
                    quote={quote}
                    onPress={() => handleQuotePress(quote)}
                  />
                ))
              )}
            </>
          )}

          {activeTab === 'contractors' && (
            <>
              {/* Search Bar */}
              <View style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary }]}>
                <Icon
                  name="search"
                  size={18}
                  color={colors.textSecondary}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={[styles.searchInput, { color: colors.textPrimary }]}
                  placeholder="Search contractors..."
                  placeholderTextColor={colors.textSecondary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Icon name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Filter Tabs */}
              <View style={styles.filterWrapper}>
                <FilterTabs
                  tabs={contractorFilterTabs}
                  activeTab={activeContractorFilter}
                  onTabChange={(tabId) => setActiveContractorFilter(tabId as ContractorFilterTabId)}
                  scrollable
                />
              </View>

              {/* Contractors List */}
              {contractorsLoading ? (
                <View style={styles.contractorsLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : contractors.length === 0 ? (
                <View style={styles.contractorsEmptyState}>
                  <Icon
                    name="construct"
                    size={40}
                    color={colors.textSecondary}
                    style={{ marginBottom: 8 }}
                  />
                  <Typography variant="headline" weight="semibold" style={{ marginBottom: 4 }}>
                    No contractors yet
                  </Typography>
                  <Typography variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
                    Add your trusted contractors to keep track of their visits and expenses.
                  </Typography>
                </View>
              ) : isTablet && isLandscape ? (
                <AdaptiveGrid gap={cardGap} columns={Math.min(columns, 2)}>
                  {contractors.map((contractor) => (
                    <ContractorCardCompact
                      key={contractor.id}
                      contractor={contractor}
                      onPress={() => handleContractorPress(contractor)}
                      onFavoriteToggle={() => handleToggleFavorite(contractor)}
                    />
                  ))}
                </AdaptiveGrid>
              ) : (
                contractors.map((contractor) => (
                  <ContractorCardCompact
                    key={contractor.id}
                    contractor={contractor}
                    onPress={() => handleContractorPress(contractor)}
                    onFavoriteToggle={() => handleToggleFavorite(contractor)}
                  />
                ))
              )}
            </>
          )}

          {activeTab === 'projects' && (
            <>
              {/* Filter Tabs */}
              <View style={styles.filterWrapper}>
                <FilterTabs
                  tabs={projectFilterTabs}
                  activeTab={activeProjectFilter}
                  onTabChange={(tabId) => setActiveProjectFilter(tabId as ProjectFilterTabId)}
                  scrollable
                />
              </View>

              {/* Projects List */}
              {projectsLoading ? (
                <View style={styles.listLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : projects.length === 0 ? (
                <View style={styles.listEmptyState}>
                  <Icon
                    name="hammer"
                    size={40}
                    color={colors.textSecondary}
                    style={{ marginBottom: 8 }}
                  />
                  <Typography variant="headline" weight="semibold" style={{ marginBottom: 4 }}>
                    No projects found
                  </Typography>
                  <Typography variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
                    Create projects to track your home improvement work and progress.
                  </Typography>
                </View>
              ) : (
                projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onPress={() => handleProjectPress(project)}
                    hasFloorPlans={hasFloorPlans}
                    onFloorPlanPress={handleFloorPlanPress}
                  />
                ))
              )}
            </>
          )}

          <ScreenScrollEnd testID={screenScrollEndTestId('contractors-screen')} />

        </AdaptiveContainer>
      </ScrollView>

      {/* Floating Action Button - changes based on active tab */}
      {activeTab === 'upcoming' && (
        <FloatingActionButton
          title="Schedule New Appointment"
          icon="+"
          onPress={handleAddAppointment}
          variant="teal"
          testID="contractors-fab-schedule"
        />
      )}
      {activeTab === 'quotes' && (
        <FloatingActionButton
          title="Request New Quote"
          icon="+"
          onPress={handleRequestQuote}
          variant="teal"
          testID="contractors-fab-quote"
        />
      )}
      {activeTab === 'contractors' && (
        <View
          style={[
            styles.dualButtonContainer,
            { left: containerPadding, right: containerPadding, bottom: insets.bottom + 100 },
          ]}
        >
          <ScreenFooterGlass />
          <GradientButton
            title="Search"
            icon={<Icon name="search" size={20} color={colors.white} />}
            variant="teal"
            onPress={handleFindContractor}
            fullWidth
            size="lg"
            testID="contractors-search-button"
          />
          <GradientButton
            title="Add"
            iconEmoji="+"
            variant="teal"
            onPress={handleAddContractor}
            fullWidth
            size="lg"
            testID="contractors-add-button"
          />
        </View>
      )}
      {activeTab === 'projects' && (
        <FloatingActionButton
          title="Create New Project"
          icon="+"
          onPress={handleSeeAllProjects}
          variant="teal"
          testID="contractors-fab-project"
        />
      )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // iOS 26 Quick Actions
  quickActionsOuter: {
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
  },
  quickActionsBlur: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
    overflow: 'hidden',
  },
  quickActionsOverlay: {
    ...StyleSheet.absoluteFill,
  },
  quickActionsShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  quickActionsContainer: {
    flexDirection: 'row',
    padding: 8,
    position: 'relative',
  },
  quickActionSlider: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    left: 8,
    zIndex: 0,
  },
  quickActionSliderInner: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 2,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  quickActionSliderTint: {
    ...StyleSheet.absoluteFill,
    borderRadius: 16,
  },
  quickActionWrapper: {
    flex: 1,
    zIndex: 1,
  },
  quickAction: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Section
  section: {
    borderRadius: 16,
    padding: 12,
    gap: 6,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  // Card
  card: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
    gap: 2,
  },
  dateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  // Progress
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  progressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  // Project Card
  projectCard: {
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  projectImageContainer: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  projectCardContent: {
    padding: 12,
  },
  floorPlanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  // Add Button
  addButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  // Find Pro Content
  findProContent: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  // Search Bar
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    ...scaledFont('body'),
    padding: 0,
  },
  // Filter Wrapper
  filterWrapper: {
    marginBottom: 16,
  },
  // Star Rating
  starContainer: {
    flexDirection: 'row',
    marginTop: 4,
  },
  // Contractor Card
  contractorCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  contractorCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  specialtyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  favoriteButton: {
    padding: 4,
  },
  contractorCardBody: {
    marginBottom: 12,
  },
  contractorCardStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statItem: {
    alignItems: 'center',
  },
  callButton: {
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contactButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  contactButtonLabel: {
    marginLeft: 6,
  },
  expiringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  contractorsLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  contractorsEmptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  // List loading and empty states (shared)
  listLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  listEmptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  // Dual Floating Buttons
  dualButtonContainer: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    // Tall enough that the glass fade begins well above the buttons, so its
    // top edge reads as transparent rather than a hard line over the list.
    paddingTop: 32,
    overflow: 'hidden',
  },
});

export default LaborHubDashboard;
