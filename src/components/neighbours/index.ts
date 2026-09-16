/**
 * Neighbours — the map surface's own components.
 *
 * House-only by construction (`@api/neighbours` is gated to the House brand on
 * the Worker and the router is not mounted elsewhere), so these deliberately do
 * NOT go through `@components/common`'s shared barrel — a Budget or Health build
 * has no reason to pull a map marker into its graph.
 */
export { NeighbourAvatar, avatarTintFor, type NeighbourAvatarProps } from './NeighbourAvatar';
export {
  NeighbourMapMarker,
  MARKER_SIZE,
  MARKER_SELECTED_SIZE,
  type NeighbourMapMarkerProps,
} from './NeighbourMapMarker';
export {
  NeighbourClusterMarker,
  clusterSizeFor,
  CLUSTER_MIN_SIZE,
  CLUSTER_MAX_SIZE,
  type NeighbourClusterMarkerProps,
} from './NeighbourClusterMarker';
export {
  NeighbourPeopleStack,
  STACK_DEFAULT_MAX,
  type NeighbourPeopleStackProps,
} from './NeighbourPeopleStack';
export { NeighbourCard, type NeighbourCardProps } from './NeighbourCard';
export { NeighbourPeekCard, type NeighbourPeekCardProps } from './NeighbourPeekCard';
