import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbstractFileUploader } from './file-uploader';

class MockFileUploader extends AbstractFileUploader {
  isValidUploadSettings(): boolean {
    return true;
  }

  listFiles(): never {
    throw new Error('not implemented');
  }

  saveFile(_param: never): Promise<void> {
    throw new Error('not implemented');
  }

  deleteFile(_attachment: never): void {
    throw new Error('not implemented');
  }

  deleteFiles(_attachments: never[]): void {
    throw new Error('not implemented');
  }

  uploadAttachment(_readable: never, _attachment: never): Promise<void> {
    throw new Error('not implemented');
  }

  respond(_res: never, _attachment: never, _opts?: never): void {
    throw new Error('not implemented');
  }

  findDeliveryFile(_attachment: never): Promise<NodeJS.ReadableStream> {
    throw new Error('not implemented');
  }

  generateTemporaryUrl(_attachment: never, _opts?: never): Promise<never> {
    throw new Error('not implemented');
  }
}

describe('AbstractFileUploader.isWritable', () => {
  let uploader: MockFileUploader;

  beforeEach(() => {
    uploader = new MockFileUploader({} as never);
    // Mock deleteTmpFile to succeed by default
    uploader.deleteTmpFile = vi.fn<any>().mockResolvedValue(undefined);
  });

  describe('when saveFile succeeds', () => {
    beforeEach(() => {
      uploader.saveFile = vi.fn<any>().mockResolvedValue(undefined);
    });

    it('should return true', async () => {
      const result = await uploader.isWritable();
      expect(result).toBe(true);
    });

    it('should call saveFile with the tmp file path', async () => {
      await uploader.isWritable();
      expect(uploader.saveFile).toHaveBeenCalledWith({
        filePath: expect.stringMatching(/^[a-f0-9-]+\.growi$/),
        contentType: 'text/plain',
        data: expect.any(String),
      });
    });

    it('should call deleteTmpFile with the tmp file path', async () => {
      await uploader.isWritable();
      expect(uploader.deleteTmpFile).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9-]+\.growi$/),
      );
    });
  });

  describe('when saveFile fails', () => {
    beforeEach(() => {
      uploader.saveFile = vi
        .fn<any>()
        .mockRejectedValue(new Error('save failed'));
    });

    it('should return false', async () => {
      const result = await uploader.isWritable();
      expect(result).toBe(false);
    });

    it('should not call deleteTmpFile', async () => {
      await uploader.isWritable();
      expect(uploader.deleteTmpFile).not.toHaveBeenCalled();
    });
  });

  describe('when deleteTmpFile throws an error', () => {
    beforeEach(() => {
      uploader.saveFile = vi.fn<any>().mockResolvedValue(undefined);
      uploader.deleteTmpFile = vi
        .fn<any>()
        .mockRejectedValue(new Error('delete failed'));
    });

    it('should still return true', async () => {
      const result = await uploader.isWritable();
      expect(result).toBe(true);
    });
  });
});
