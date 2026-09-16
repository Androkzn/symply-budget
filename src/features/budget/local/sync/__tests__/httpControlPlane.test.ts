import { ackMailboxBlobs, depositMailboxBlob, fetchMailboxBlobs } from '../../controlPlaneClient';
import { HttpControlPlaneClient } from '../httpControlPlane';

jest.mock('../../controlPlaneClient', () => ({
  ackMailboxBlobs: jest.fn(async () => undefined),
  depositMailboxBlob: jest.fn(async () => ({blob:{blobId:'blob', createdAt:new Date().toISOString(), expiresAt:new Date().toISOString()}})),
  fetchMailboxBlobs: jest.fn(async () => ({blobs:[], hasMore:false})),
}));

beforeEach(() => jest.clearAllMocks());
describe('household-scoped mailbox transport', () => {
  it('scopes deposit, fetch and acknowledgement to the same background household', async () => {
    const transport = new HttpControlPlaneClient('background-household');
    const ciphertext = new Uint8Array([1,2]);
    await transport.depositMailbox({householdId:'background-household',recipientDeviceId:'peer',ciphertext,wake:false});
    await transport.fetchMailbox('background-household','self','cursor');
    await transport.ackMailbox(['blob'],'self');
    expect(depositMailboxBlob).toHaveBeenCalledWith(ciphertext,'peer',{householdId:'background-household',wake:false});
    expect(fetchMailboxBlobs).toHaveBeenCalledWith('cursor','background-household');
    expect(ackMailboxBlobs).toHaveBeenCalledWith(['blob'],'self','background-household');
  });
  it('refuses a caller accidentally passing another household', async () => {
    const transport = new HttpControlPlaneClient('a');
    await expect(transport.fetchMailbox('b','self')).rejects.toThrow('household mismatch');
    await expect(transport.depositMailbox({householdId:'b',ciphertext:new Uint8Array([1])})).rejects.toThrow('household mismatch');
    expect(fetchMailboxBlobs).not.toHaveBeenCalled();
    expect(depositMailboxBlob).not.toHaveBeenCalled();
  });
});
