import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { G } from 'react-native-svg';

import {
  GARDEN_OBJECT_CATEGORIES,
  type GardenObjectCategoryId,
  type GardenObjectPreset,
  type SimpleShape,
  searchGardenObjectPresets,
} from '@/types/garden-object-presets';
import type { GardenPlanObject } from '@/types/garden-objects';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import {CornerRadius, Spacing, useAppColors } from '@theme';
import { palette } from '@theme/colors';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { renderGardenObjectBody } from './GardenObjectRenderer';

const ACCENT = palette.button.teal;

const CUSTOM_COLOR_SWATCHES = [
  '#0EA5E9',
  '#16A34A',
  '#A16207',
  '#7C3AED',
  '#EC4899',
  '#EF4444',
  '#F59E0B',
  '#64748B',
] as const;

const CUSTOM_SHAPES: ReadonlyArray<{ id: SimpleShape; label: string; iconName: string }> = [
  { id: 'circle', label: 'Circle', iconName: 'ellipse-outline' },
  { id: 'square', label: 'Rounded square', iconName: 'square-outline' },
  { id: 'rectangle', label: 'Rectangle', iconName: 'tablet-landscape-outline' },
];

export interface GardenObjectLibrarySelection {
  kind: 'preset';
  preset: GardenObjectPreset;
}

export interface GardenObjectLibraryCustomSelection {
  kind: 'custom';
  shape: SimpleShape;
  color: string;
  label: string;
}

export type GardenObjectLibraryResult =
  | GardenObjectLibrarySelection
  | GardenObjectLibraryCustomSelection;

interface GardenObjectLibrarySheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (result: GardenObjectLibraryResult) => void;
}

type Tab = 'library' | 'custom';

export function GardenObjectLibrarySheet({
  visible,
  onClose,
  onSelect,
}: GardenObjectLibrarySheetProps) {
  const colors = useAppColors();  const [tab, setTab] = useState<Tab>('library');
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<GardenObjectCategoryId | 'all'>('all');
  const [customShape, setCustomShape] = useState<SimpleShape>('square');
  const [customColor, setCustomColor] = useState<string>(CUSTOM_COLOR_SWATCHES[0]);
  const [customLabel, setCustomLabel] = useState<string>('');
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (!visible) {
      // Reset transient state on close so the next open feels fresh.
      setQuery('');
      setActiveCategory('all');
      setTab('library');
      setCustomLabel('');
      setCustomShape('square');
      setCustomColor(CUSTOM_COLOR_SWATCHES[0]);
    }
  }, [visible]);

  const presets = useMemo(() => searchGardenObjectPresets(query), [query]);

  const filteredPresets = useMemo(() => {
    if (activeCategory === 'all') return presets;
    return presets.filter(preset => preset.category === activeCategory);
  }, [activeCategory, presets]);

  const groupedSections = useMemo(() => {
    if (activeCategory !== 'all') {
      return [
        {
          id: activeCategory,
          label:
            GARDEN_OBJECT_CATEGORIES.find(category => category.id === activeCategory)?.label ??
            'Results',
          presets: filteredPresets,
        },
      ];
    }
    return GARDEN_OBJECT_CATEGORIES.map(category => ({
      id: category.id,
      label: category.label,
      presets: filteredPresets.filter(preset => preset.category === category.id),
    })).filter(section => section.presets.length > 0);
  }, [activeCategory, filteredPresets]);

  const handlePresetSelect = (preset: GardenObjectPreset) => {
    onSelect({ kind: 'preset', preset });
    onClose();
  };

  const handleCustomSelect = () => {
    onSelect({
      kind: 'custom',
      shape: customShape,
      color: customColor,
      label: customLabel.trim() || 'Custom shape',
    });
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      title="Add object"
      noPadding
      showCloseButton
    >
      <View style={styles.root}>
        {/* Tabs */}
        <View style={[styles.tabsRow, { backgroundColor: colors.groupedListBackground }]}>
          <TabButton
            label="Library"
            ionIcon="grid"
            active={tab === 'library'}
            onPress={() => setTab('library')}
          />
          <TabButton
            label="Custom shape"
            ionIcon="shapes"
            active={tab === 'custom'}
            onPress={() => setTab('custom')}
          />
        </View>

        {tab === 'library' ? (
          <>
            {/* Search */}
            <View
              style={[
                styles.searchRow,
                {
                  backgroundColor: colors.groupedListBackground,
                  borderColor: colors.borderColor,
                },
              ]}
            >
              <Icon name="search" size={18} color={colors.textTertiary} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search pool, fountain, bench…"
                placeholderTextColor={colors.textTertiary}
                style={[styles.searchInput, { color: colors.textPrimary }]}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <Icon name="close-circle" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Categories */}
            <View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoriesRow}
              >
                <CategoryChip
                  label="All"
                  ionIcon="apps"
                  accent={ACCENT}
                  active={activeCategory === 'all'}
                  onPress={() => setActiveCategory('all')}
                />
                {GARDEN_OBJECT_CATEGORIES.map(category => (
                  <CategoryChip
                    key={category.id}
                    label={category.label}
                    ionIcon={category.ionIcon}
                    accent={category.accent}
                    active={activeCategory === category.id}
                    onPress={() => setActiveCategory(category.id)}
                  />
                ))}
              </ScrollView>
            </View>

            {/* Grid */}
            <ScrollView
              style={styles.grid}
              contentContainerStyle={styles.gridContent}
              showsVerticalScrollIndicator={false}
            >
              {groupedSections.length === 0 ? (
                <View style={styles.empty}>
                  <Icon name="leaf-outline" size={32} color={colors.textTertiary} />
                  <Typography variant="body" color="textSecondary" style={styles.emptyTitle}>
                    No matches
                  </Typography>
                  <Typography variant="caption1" color="textTertiary" style={styles.emptyHint}>
                    Try another keyword or pick a category
                  </Typography>
                </View>
              ) : (
                groupedSections.map(section => (
                  <View key={section.id} style={styles.section}>
                    <Typography
                      variant="caption1"
                      weight="semibold"
                      color="textSecondary"
                      style={styles.sectionTitle}
                    >
                      {section.label.toUpperCase()}
                    </Typography>
                    <View style={styles.cardsWrap}>
                      {section.presets.map(preset => (
                        <PresetCard
                          key={preset.id}
                          preset={preset}
                          onPress={() => handlePresetSelect(preset)}
                        />
                      ))}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </>
        ) : (
          <CustomTab
            shape={customShape}
            color={customColor}
            label={customLabel}
            onShapeChange={setCustomShape}
            onColorChange={setCustomColor}
            onLabelChange={setCustomLabel}
            onAdd={handleCustomSelect}
          />
        )}
      </View>
    </BottomSheet>
  );
}

interface TabButtonProps {
  label: string;
  ionIcon: string;
  active: boolean;
  onPress: () => void;
}

function TabButton({ label, ionIcon, active, onPress }: TabButtonProps) {
  const colors = useAppColors();
  return (
    <TouchableOpacity
      style={[
        styles.tabButton,
        {
          backgroundColor: active ? colors.backgroundMain : 'transparent',
          shadowOpacity: active ? 0.08 : 0,
        },
      ]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <Icon
        name={ionIcon as React.ComponentProps<typeof Ionicons>['name']}
        size={16}
        color={active ? ACCENT : colors.textSecondary}
      />
      <Typography
        variant="caption1"
        weight={active ? 'semibold' : 'regular'}
        color={active ? ACCENT : colors.textSecondary}
      >
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

interface CategoryChipProps {
  label: string;
  ionIcon: string;
  accent: string;
  active: boolean;
  onPress: () => void;
}

function CategoryChip({ label, ionIcon, accent, active, onPress }: CategoryChipProps) {
  const colors = useAppColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.categoryChip,
        {
          borderColor: active ? accent : colors.borderColor,
          backgroundColor: active ? `${accent}15` : colors.backgroundSecondary,
        },
      ]}
    >
      <Icon
        name={ionIcon as React.ComponentProps<typeof Ionicons>['name']}
        size={14}
        color={active ? accent : colors.textSecondary}
      />
      <Typography
        variant="caption1"
        weight={active ? 'semibold' : 'regular'}
        color={active ? accent : colors.textPrimary}
      >
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

interface PresetCardProps {
  preset: GardenObjectPreset;
  onPress: () => void;
}

function PresetCard({ preset, onPress }: PresetCardProps) {
  const colors = useAppColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.card,
        {
          backgroundColor: colors.backgroundSecondary,
          borderColor: colors.borderColor,
        },
      ]}
    >
      <View style={[styles.cardPreview, { backgroundColor: colors.groupedListBackground }]}>
        <PresetPreview preset={preset} />
      </View>
      <Typography
        variant="caption1"
        weight="semibold"
        color={colors.textPrimary}
        numberOfLines={1}
        style={styles.cardLabel}
      >
        {preset.name}
      </Typography>
    </TouchableOpacity>
  );
}

const PREVIEW_VIEWBOX = 160;

function PresetPreview({ preset }: { preset: GardenObjectPreset }) {
  // Build a transient object that matches the preset's defaults so we can
  // re-use the on-canvas renderer for the preview tile.
  const fakeObject: GardenPlanObject = useMemo(
    () => ({
      id: `preview-${preset.id}`,
      type: preset.type,
      x: 0.5,
      y: 0.5,
      width: preset.defaultWidth,
      height: preset.defaultHeight,
      rotation: 0,
      label: preset.defaultLabel,
      color: preset.defaultColor,
      metadata: {
        presetId: preset.id,
        iconKey: preset.iconKey,
        shape: preset.shape,
      },
    }),
    [preset],
  );

  // Scale so the larger dimension fills ~78% of the preview tile.
  const aspect = preset.defaultWidth / preset.defaultHeight;
  const targetMax = PREVIEW_VIEWBOX * 0.78;
  const previewWidth = aspect >= 1 ? targetMax : targetMax * aspect;
  const previewHeight = aspect >= 1 ? targetMax / aspect : targetMax;

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${PREVIEW_VIEWBOX} ${PREVIEW_VIEWBOX}`}>
      <G transform={`translate(${PREVIEW_VIEWBOX / 2} ${PREVIEW_VIEWBOX / 2})`}>
        {renderGardenObjectBody({
          object: fakeObject,
          width: previewWidth,
          height: previewHeight,
          color: preset.defaultColor,
          stroke: '#1F2937',
          strokeWidth: 2.5,
        })}
      </G>
    </Svg>
  );
}

interface CustomTabProps {
  shape: SimpleShape;
  color: string;
  label: string;
  onShapeChange: (shape: SimpleShape) => void;
  onColorChange: (color: string) => void;
  onLabelChange: (label: string) => void;
  onAdd: () => void;
}

function CustomTab({
  shape,
  color,
  label,
  onShapeChange,
  onColorChange,
  onLabelChange,
  onAdd,
}: CustomTabProps) {
  const colors = useAppColors();

  const previewObject: GardenPlanObject = useMemo(
    () => ({
      id: 'custom-preview',
      type: 'patio',
      x: 0.5,
      y: 0.5,
      width: 0.4,
      height: shape === 'rectangle' ? 0.22 : 0.4,
      rotation: 0,
      label: label.trim() || 'Custom shape',
      color,
      metadata: { presetId: 'custom', shape, custom: true },
    }),
    [color, label, shape],
  );

  const previewAspect = shape === 'rectangle' ? 1.8 : 1;
  const previewMax = 200;
  const previewWidth = previewAspect >= 1 ? previewMax : previewMax * previewAspect;
  const previewHeight = previewAspect >= 1 ? previewMax / previewAspect : previewMax;

  return (
    <ScrollView
      style={styles.customTab}
      contentContainerStyle={styles.customTabContent}
      {...keyboardDismissScrollProps}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.customPreview,
          { backgroundColor: colors.groupedListBackground, borderColor: colors.borderColor },
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 240 220">
          <G transform="translate(120 110)">
            {renderGardenObjectBody({
              object: previewObject,
              width: previewWidth,
              height: previewHeight,
              color,
              stroke: '#1F2937',
              strokeWidth: 3,
            })}
          </G>
        </Svg>
      </View>

      <Typography
        variant="caption1"
        color="textSecondary"
        weight="semibold"
        style={styles.customGroupLabel}
      >
        SHAPE
      </Typography>
      <View style={styles.customShapeRow}>
        {CUSTOM_SHAPES.map(option => {
          const active = option.id === shape;
          return (
            <TouchableOpacity
              key={option.id}
              activeOpacity={0.85}
              onPress={() => onShapeChange(option.id)}
              style={[
                styles.customShapeButton,
                {
                  borderColor: active ? ACCENT : colors.borderColor,
                  backgroundColor: active ? `${ACCENT}10` : colors.backgroundSecondary,
                },
              ]}
            >
              <Icon
                name={option.iconName as React.ComponentProps<typeof Ionicons>['name']}
                size={22}
                color={active ? ACCENT : colors.textSecondary}
              />
              <Typography
                variant="caption2"
                weight={active ? 'semibold' : 'regular'}
                color={active ? ACCENT : colors.textSecondary}
              >
                {option.label}
              </Typography>
            </TouchableOpacity>
          );
        })}
      </View>

      <Typography
        variant="caption1"
        color="textSecondary"
        weight="semibold"
        style={styles.customGroupLabel}
      >
        COLOR
      </Typography>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.colorRow}
      >
        {CUSTOM_COLOR_SWATCHES.map(swatch => {
          const active = swatch.toLowerCase() === color.toLowerCase();
          return (
            <TouchableOpacity
              key={swatch}
              onPress={() => onColorChange(swatch)}
              activeOpacity={0.8}
              style={[
                styles.colorSwatch,
                {
                  borderColor: active ? ACCENT : colors.borderColor,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
            >
              <View style={[styles.colorSwatchInner, { backgroundColor: swatch }]} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Typography
        variant="caption1"
        color="textSecondary"
        weight="semibold"
        style={styles.customGroupLabel}
      >
        LABEL
      </Typography>
      <TextInput
        value={label}
        onChangeText={onLabelChange}
        placeholder="Name this shape"
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.customLabelInput,
          {
            backgroundColor: colors.backgroundSecondary,
            borderColor: colors.borderColor,
            color: colors.textPrimary,
          },
        ]}
        returnKeyType="done"
      />

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onAdd}
        style={[styles.addCustomButton, { backgroundColor: ACCENT }]}
      >
        <Icon name="add-circle" size={18} color="#FFFFFF" />
        <Typography variant="body" weight="semibold" color="#FFFFFF">
          Add to plan
        </Typography>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    margin: Spacing.md,
    padding: 4,
    borderRadius: CornerRadius.full,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: CornerRadius.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: Spacing.md,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  categoriesRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: CornerRadius.full,
    borderWidth: 1,
  },
  grid: {
    flex: 1,
  },
  gridContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 4,
  },
  emptyTitle: {},
  emptyHint: {},
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    marginBottom: 8,
    letterSpacing: 0.6,
  },
  cardsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '31%',
    minWidth: 96,
    flexGrow: 1,
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    gap: 6,
    alignItems: 'center',
  },
  cardPreview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: CornerRadius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    textAlign: 'center',
  },
  customTab: {
    flex: 1,
  },
  customTabContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  customPreview: {
    height: 200,
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customGroupLabel: {
    letterSpacing: 0.6,
    marginTop: Spacing.md,
    marginBottom: 8,
  },
  customShapeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  customShapeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
  },
  colorSwatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchInner: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  customLabelInput: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    fontSize: 15,
  },
  addCustomButton: {
    marginTop: Spacing.lg,
    height: 50,
    borderRadius: CornerRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
