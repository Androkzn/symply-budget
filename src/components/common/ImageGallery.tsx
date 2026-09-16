import React, { useState } from 'react';
import { View, Image, TouchableOpacity, Modal, ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useAppColors } from '@theme';
import { palette } from '@theme/index';

export interface GalleryImage {
  id: string;
  url: string;
  thumbnail_url?: string;
  caption?: string;
  page_number?: number;
  system_category?: string;
}

interface ImageGalleryProps {
  images: GalleryImage[];
  thumbnailSize?: number;
  showCaptions?: boolean;
  maxThumbnails?: number;
  onImagePress?: (image: GalleryImage, index: number) => void;
}

export function ImageGallery({
  images,
  thumbnailSize = 80,
  showCaptions = false,
  maxThumbnails,
  onImagePress,
}: ImageGalleryProps) {
  const colors = useAppColors();  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [errorStates, setErrorStates] = useState<Record<string, boolean>>({});

  const displayImages = maxThumbnails ? images.slice(0, maxThumbnails) : images;
  const remainingCount = maxThumbnails && images.length > maxThumbnails
    ? images.length - maxThumbnails
    : 0;

  const handleThumbnailPress = (index: number) => {
    if (onImagePress) {
      onImagePress(images[index], index);
    } else {
      setSelectedIndex(index);
    }
  };

  const handleClose = () => {
    setSelectedIndex(null);
  };

  const handlePrevious = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const handleNext = () => {
    if (selectedIndex !== null && selectedIndex < images.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  };

  const handleImageLoad = (id: string) => {
    setLoadingStates((prev) => ({ ...prev, [id]: false }));
  };

  const handleImageError = (id: string) => {
    setLoadingStates((prev) => ({ ...prev, [id]: false }));
    setErrorStates((prev) => ({ ...prev, [id]: true }));
  };

  const handleImageLoadStart = (id: string) => {
    setLoadingStates((prev) => ({ ...prev, [id]: true }));
  };

  if (images.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbnailContainer}
      >
        {displayImages.map((image, index) => (
          <TouchableOpacity
            key={image.id}
            style={[
              styles.thumbnailWrapper,
              { width: thumbnailSize, height: thumbnailSize },
            ]}
            onPress={() => handleThumbnailPress(index)}
            activeOpacity={0.8}
          >
            {loadingStates[image.id] && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
            {errorStates[image.id] ? (
              <View style={styles.errorPlaceholder}>
                <Icon name="image-outline" size={24} color={palette.gray[400]} />
              </View>
            ) : (
              <Image
                source={{ uri: image.thumbnail_url || image.url }}
                style={styles.thumbnail}
                resizeMode="cover"
                onLoadStart={() => handleImageLoadStart(image.id)}
                onLoad={() => handleImageLoad(image.id)}
                onError={() => handleImageError(image.id)}
              />
            )}
            {image.page_number && (
              <View style={styles.pageNumberBadge}>
                <Text style={styles.pageNumberText}>p.{image.page_number}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
        {remainingCount > 0 && (
          <TouchableOpacity
            style={[
              styles.thumbnailWrapper,
              styles.moreIndicator,
              { width: thumbnailSize, height: thumbnailSize },
            ]}
            onPress={() => handleThumbnailPress(maxThumbnails || 0)}
            activeOpacity={0.8}
          >
            <Text style={styles.moreText}>+{remainingCount}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {showCaptions && displayImages.length === 1 && displayImages[0].caption && (
        <Text style={styles.caption} numberOfLines={2}>
          {displayImages[0].caption}
        </Text>
      )}

      {/* Full-screen Image Viewer Modal */}
      <Modal
        visible={selectedIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
      >
        <View style={styles.modalContainer}>
          {/* Close button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="close" size={28} color={palette.system.white} />
          </TouchableOpacity>

          {/* Image counter */}
          {images.length > 1 && selectedIndex !== null && (
            <View style={styles.counterContainer}>
              <Text style={styles.counterText}>
                {selectedIndex + 1} / {images.length}
              </Text>
            </View>
          )}

          {/* Main image */}
          {selectedIndex !== null && (
            <View style={styles.imageContainer}>
              <Image
                source={{ uri: images[selectedIndex].url }}
                style={[
                  styles.fullImage,
                  { width: windowWidth, height: Math.max(240, windowHeight - 200) },
                ]}
                resizeMode="contain"
              />
              {images[selectedIndex].caption && (
                <View style={styles.captionContainer}>
                  <Text style={styles.fullCaption}>
                    {images[selectedIndex].caption}
                  </Text>
                  {images[selectedIndex].page_number && (
                    <Text style={styles.pageInfo}>
                      Page {images[selectedIndex].page_number}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Navigation arrows */}
          {images.length > 1 && (
            <>
              <TouchableOpacity
                style={[
                  styles.navButton,
                  styles.navButtonLeft,
                  selectedIndex === 0 && styles.navButtonDisabled,
                ]}
                onPress={handlePrevious}
                disabled={selectedIndex === 0}
              >
                <Icon
                  name="chevron-back"
                  size={32}
                  color={selectedIndex === 0 ? palette.gray[400] : palette.system.white}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.navButton,
                  styles.navButtonRight,
                  selectedIndex === images.length - 1 && styles.navButtonDisabled,
                ]}
                onPress={handleNext}
                disabled={selectedIndex === images.length - 1}
              >
                <Icon
                  name="chevron-forward"
                  size={32}
                  color={selectedIndex === images.length - 1 ? palette.gray[400] : palette.system.white}
                />
              </TouchableOpacity>
            </>
          )}

          {/* Thumbnail strip at bottom */}
          {images.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.thumbnailStrip}
              contentContainerStyle={styles.thumbnailStripContent}
            >
              {images.map((image, index) => (
                <TouchableOpacity
                  key={image.id}
                  style={[
                    styles.stripThumbnail,
                    index === selectedIndex && styles.stripThumbnailActive,
                  ]}
                  onPress={() => setSelectedIndex(index)}
                >
                  <Image
                    source={{ uri: image.thumbnail_url || image.url }}
                    style={styles.stripThumbnailImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  thumbnailContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
  },
  thumbnailWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: palette.gray[100],
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.gray[100],
  },
  errorPlaceholder: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.gray[100],
  },
  pageNumberBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pageNumberText: {
    fontSize: 10,
    color: palette.system.white,
  },
  moreIndicator: {
    backgroundColor: palette.gray[200],
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.gray[600],
  },
  caption: {
    marginTop: 8,
    fontSize: 12,
    color: palette.gray[600],
    paddingHorizontal: 4,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  counterContainer: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  counterText: {
    color: palette.system.white,
    fontSize: 16,
    fontWeight: '500',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
    paddingBottom: 120,
  },
  fullImage: {
  },
  captionContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 12,
    borderRadius: 8,
  },
  fullCaption: {
    color: palette.system.white,
    fontSize: 14,
    lineHeight: 20,
  },
  pageInfo: {
    color: palette.gray[300],
    fontSize: 12,
    marginTop: 4,
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 24,
  },
  navButtonLeft: {
    left: 16,
  },
  navButtonRight: {
    right: 16,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  thumbnailStrip: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    height: 60,
  },
  thumbnailStripContent: {
    paddingHorizontal: 20,
    gap: 8,
    alignItems: 'center',
  },
  stripThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  stripThumbnailActive: {
    borderColor: palette.blue[500],
  },
  stripThumbnailImage: {
    width: '100%',
    height: '100%',
  },
});
