import { ENV } from '@config/env';
import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import { useAuthStore } from '@stores/authStore';
import { householdsListResponseSchema, householdDetailResponseSchema } from '@symply/contracts';


import { apiClient } from './client';
import { putUploadViaXhr } from './e2ePutUpload';
import { shouldValidateApiResponses, validateApiResponse } from './validateResponse';

// Types

/** 'metric' → sqm, 'imperial' → sqft — the ONE global switch for a property's room/space sizes. */
export type HouseUnitSystem = 'metric' | 'imperial';

export interface Household {
  id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: 'CA' | 'US' | null;
  /** The ONE global "Imperial vs Metric" preference for this property's room/space sizes, null if unset. */
  unit_system: HouseUnitSystem | null;
  photo_key: string | null;
  photo_url: string | null; // Generated from photo_key
  /**
   * H6 encrypted-channel descriptor, when the home photo's BYTES travelled
   * through `@features/house/local/blobs` instead of the legacy R2 upload.
   *
   * This field is what makes the home photo reach another member at all.
   * `photo_key` names an R2 object a local-first home never wrote and
   * `photo_url` is signed from it, so a row carrying only those is the same bug
   * `ApplianceDocument.blob` exists to close, one table over: the property
   * syncs — name, address, rooms — and the picture does not. A descriptor is
   * content-derived and device-independent, so any enrolled peer can open it.
   *
   * Optional and additive, exactly as `ApplianceDocument.blob` and
   * `TaskPhoto.blob` are. A property whose photo was uploaded on the legacy
   * server path has no descriptor and keeps its `photo_url`; only photos
   * written through the ledger carry this, and only those render through
   * `HouseBlobImage`.
   *
   * Type-only import: the blobs barrel pulls `expo-file-system` and the crypto
   * engine, and this module is on the cold path of every screen. `import type`
   * is erased at compile time, so nothing is added to the module graph.
   */
  photo_blob?: HouseBlobDescriptor;
  /** Owner's real purchase price in cents (what they paid), null if unset. */
  purchase_price: number | null;
  /** Purchase date, ISO 'YYYY-MM-DD', null if unset. */
  purchase_date: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
  my_role: 'owner' | 'member';
  floor_plan_count?: number;
}

export interface HouseholdMember {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string;
  role: 'owner' | 'member';
  joined_at: string;
}

export interface HouseholdInvitation {
  id: string;
  email: string;
  role: 'owner' | 'member';
  expires_at: string;
  created_at: string;
}

// Request types
interface CreateHouseholdRequest {
  name: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: 'CA' | 'US';
  /** Sets the ONE global "Imperial vs Metric" preference for this property's room/space sizes; null clears it. */
  unit_system?: HouseUnitSystem | null;
  photo_key?: string | null;
  /** Real purchase price in cents (what the owner paid); null clears it. */
  purchase_price?: number | null;
  /** Purchase date, ISO 'YYYY-MM-DD'; null clears it. */
  purchase_date?: string | null;
}

interface UpdateHouseholdRequest extends Partial<CreateHouseholdRequest> {}

interface PhotoUploadResponse {
  success: boolean;
  image_key: string;
}

interface InviteMemberRequest {
  email: string;
  role: 'owner' | 'member';
}

// Response types
interface HouseholdsListResponse {
  households: Household[];
}

interface HouseholdResponse {
  household: Household;
}

interface HouseholdDetailResponse {
  household: Household;
  members: HouseholdMember[];
}

interface InvitationsListResponse {
  invitations: HouseholdInvitation[];
}

interface InvitationResponse {
  invitation: {
    id: string;
    email: string;
    role: 'owner' | 'member';
  };
}

interface MemberResponse {
  member: HouseholdMember;
}

interface ValidateInvitationResponse {
  valid: boolean;
  household?: { id: string; name: string };
  invitedBy?: string;
  role?: 'owner' | 'member';
  expiresAt?: string;
  error?: string;
}

// ===== Shareable invite links + owner-approved join requests =====

export interface CreateInviteLinkRequest {
  role?: 'owner' | 'member';
  expires_in_days?: number;
  max_uses?: number;
}

interface CreateInviteLinkResponse {
  invite_link: {
    id: string;
    url: string;
    short_url: string;
    token: string;
    short_code: string;
    role: 'owner' | 'member';
    expires_at: string;
  };
}

interface ValidateInviteLinkResponse {
  valid: boolean;
  household?: { id: string; name: string };
  role?: 'owner' | 'member';
  expiresAt?: string;
  alreadyMember?: boolean;
  homePhotoUrl?: string | null;
  inviter?: { displayName: string | null; avatarUrl: string | null; email: string | null };
  error?: string;
}

interface RequestToJoinResponse {
  status: 'pending' | 'already_member';
  request_id?: string;
  household: { id: string; name: string };
}

export interface JoinRequest {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string;
  requested_at: string;
}

/** Owner-facing join request with household context (home feed / alerts). */
export interface OwnerJoinRequest extends JoinRequest {
  household_id: string;
  household_name: string;
}

interface JoinRequestsListResponse {
  requests: JoinRequest[];
}

export interface MyJoinRequest {
  id: string;
  household_id: string;
  household_name: string;
  requested_at: string;
}

interface MyJoinRequestsResponse {
  requests: MyJoinRequest[];
}

interface OwnerJoinRequestsResponse {
  requests: OwnerJoinRequest[];
}

export interface UserSearchResult {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string;
}

interface UserSearchResponse {
  users: UserSearchResult[];
}

const remoteHouseholdsApi = {
  // Household CRUD
  list: () =>
    apiClient.get<HouseholdsListResponse>('/households').then((res) => {
      const data = res.data;
      if (!shouldValidateApiResponses()) return data;
      return validateApiResponse(
        householdsListResponseSchema,
        data,
        'GET /households'
      );
    }),

  create: (data: CreateHouseholdRequest) =>
    apiClient.post<HouseholdResponse>('/households', data).then((res) => res.data),

  get: (householdId: string) =>
    apiClient.get<HouseholdDetailResponse>(`/households/${householdId}`).then((res) => {
      const data = res.data;
      if (!shouldValidateApiResponses()) return data;
      return validateApiResponse(
        householdDetailResponseSchema,
        data,
        `GET /households/${householdId}`,
      );
    }),

  update: (householdId: string, data: UpdateHouseholdRequest) =>
    apiClient.patch<HouseholdResponse>(`/households/${householdId}`, data).then((res) => res.data),

  delete: (householdId: string) =>
    apiClient.delete(`/households/${householdId}`),

  // Leave a household (any member). The sole owner cannot leave — they must
  // transfer ownership or delete the property instead (backend enforces this).
  leave: (householdId: string) =>
    apiClient.post(`/households/${householdId}/leave`, {}),

  // Invitations
  invite: (householdId: string, data: InviteMemberRequest) =>
    apiClient
      .post<InvitationResponse>(`/households/${householdId}/invite`, data)
      .then((res) => res.data),

  getInvitations: (householdId: string) =>
    apiClient
      .get<InvitationsListResponse>(`/households/${householdId}/invitations`)
      .then((res) => res.data),

  cancelInvitation: (householdId: string, invitationId: string) =>
    apiClient.delete(`/households/${householdId}/invitations/${invitationId}`),

  validateInvitation: (token: string) =>
    apiClient
      .post<ValidateInvitationResponse>('/invitations/validate', { token })
      .then((res) => res.data),

  acceptInvitation: (token: string) =>
    apiClient.post<HouseholdResponse>('/invitations/accept', { token }).then((res) => res.data),

  // In-app invitation accept/decline by id (no emailed token). Used when an
  // existing user taps the "you've been invited" notification.
  acceptInvitationInApp: (invitationId: string) =>
    apiClient
      .post<HouseholdResponse>(`/invitations/${invitationId}/accept-in-app`, {})
      .then((res) => res.data),

  declineInvitationInApp: (invitationId: string) =>
    apiClient.post(`/invitations/${invitationId}/decline-in-app`, {}),

  // Search existing app users to invite directly (owners only). Excludes
  // current members. `q` matches display name or email (min 2 chars).
  searchUsers: (householdId: string, q: string) =>
    apiClient
      .get<UserSearchResponse>(`/households/${householdId}/user-search`, { params: { q } })
      .then((res) => res.data),

  // Shareable invite links (open link → owner approves)
  createInviteLink: (householdId: string, data: CreateInviteLinkRequest = {}) =>
    apiClient
      .post<CreateInviteLinkResponse>(`/households/${householdId}/invite-link`, data)
      .then((res) => res.data),

  validateInviteLink: (token: string) =>
    apiClient
      .post<ValidateInviteLinkResponse>('/invite-links/validate', { token })
      .then((res) => res.data),

  requestToJoin: (token: string) =>
    apiClient
      .post<RequestToJoinResponse>('/invite-links/request', { token })
      .then((res) => res.data),

  // The current user's own pending join requests (awaiting owner approval).
  getMyJoinRequests: () =>
    apiClient
      .get<MyJoinRequestsResponse>('/invite-links/my-requests')
      .then((res) => res.data),

  getOwnerPendingJoinRequests: () =>
    apiClient
      .get<OwnerJoinRequestsResponse>('/invite-links/owner-pending', {
        params: { _ts: Date.now() },
      })
      .then((res) => res.data),

  // Join requests (owner-side approval)
  getJoinRequests: (householdId: string) =>
    apiClient
      .get<JoinRequestsListResponse>(`/households/${householdId}/join-requests`)
      .then((res) => res.data),

  approveJoinRequest: (householdId: string, requestId: string) =>
    apiClient
      .post<HouseholdResponse>(
        `/households/${householdId}/join-requests/${requestId}/approve`,
        {}
      )
      .then((res) => res.data),

  denyJoinRequest: (householdId: string, requestId: string) =>
    apiClient.post(`/households/${householdId}/join-requests/${requestId}/deny`, {}),

  // Members
  removeMember: (householdId: string, userId: string) =>
    apiClient.delete(`/households/${householdId}/members/${userId}`),

  updateMemberRole: (householdId: string, userId: string, role: 'owner' | 'member') =>
    apiClient
      .patch<MemberResponse>(`/households/${householdId}/members/${userId}`, { role })
      .then((res) => res.data),

  // Photo management
  uploadPhoto: async (householdId: string, imageUri: string, contentType: string = 'image/jpeg'): Promise<PhotoUploadResponse> => {
    const TAG = '[uploadPhoto]';
    console.log(`${TAG} start`, { householdId, imageUri, contentType });

    // The image/crop picker can return a bare filesystem path (no scheme) on
    // iOS; RN's fetch needs an explicit file:// URI to read it.
    const normalizedUri =
      /^[a-z]+:\/\//i.test(imageUri) || imageUri.startsWith('data:')
        ? imageUri
        : `file://${imageUri}`;
    console.log(`${TAG} normalizedUri`, normalizedUri);

    // Read the image file as blob
    let blob: Blob;
    try {
      const response = await fetch(normalizedUri);
      console.log(`${TAG} fetch(file) ok`, { status: response.status });
      blob = await response.blob();
      console.log(`${TAG} blob`, { size: blob.size, type: blob.type });
      if (!blob.size) {
        console.warn(`${TAG} blob is empty — file read produced 0 bytes`);
      }
    } catch (err) {
      console.error(`${TAG} failed to read image file`, err);
      throw err;
    }

    // Upload via XHR. axios in React Native does not reliably send a Blob as a
    // raw binary body, so we use the same proven XHR path as the task-photo
    // uploader and send the blob directly.
    const uploadUrl = `${ENV.API_BASE_URL}/households/${householdId}/photo`;
    const token = useAuthStore.getState().token;
    console.log(`${TAG} PUT`, { uploadUrl, hasToken: !!token });

    const result = await putUploadViaXhr<PhotoUploadResponse>({
      uploadUrl,
      body: blob,
      contentType,
      authorization: token,
      label: 'household-photo',
      logKind: 'network',
      networkPath: `/households/${householdId}/photo`,
    });

    return result ?? { success: true, image_key: '' };
  },

  deletePhoto: (householdId: string) =>
    apiClient.delete(`/households/${householdId}/photo`),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `householdsApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const householdsApi: typeof remoteHouseholdsApi = createHouseLocalProxy(remoteHouseholdsApi, {
  moduleName: 'households',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localHouseholdsApi').localHouseholdsApi,
});
