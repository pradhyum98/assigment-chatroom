import { useState, useCallback } from 'react';
import { useAppSelector } from '../store/hooks';
import { CryptoService } from '../services/cryptoService';

export const useCrypto = () => {
  const { user } = useAppSelector((state) => state.auth);
  // Cache of roomId -> CryptoKey
  const [roomKeys, setRoomKeys] = useState<Record<string, CryptoKey>>({});

  const getRoomKey = useCallback(async (roomId: string, encryptedRoomKeys?: Record<string, string>): Promise<CryptoKey | null> => {
    if (roomKeys[roomId]) {
      return roomKeys[roomId];
    }

    if (!user?._id || !encryptedRoomKeys || !encryptedRoomKeys[user._id]) {
      return null;
    }

    try {
      const privKeyB64 = localStorage.getItem('e2e_private_key');
      if (!privKeyB64) {
        console.warn('No local private key found. Cannot decrypt room messages.');
        return null;
      }

      const privateKey = await CryptoService.importPrivateKey(privKeyB64);
      const encryptedKeyForMe = encryptedRoomKeys[user._id];
      const roomKeyBase64 = await CryptoService.decryptRoomKey(encryptedKeyForMe, privateKey);
      const roomKey = await CryptoService.importRoomKey(roomKeyBase64);

      setRoomKeys(prev => ({ ...prev, [roomId]: roomKey }));
      return roomKey;
    } catch (err) {
      console.error('Failed to get/decrypt room key for room', roomId, err);
      return null;
    }
  }, [user?._id, roomKeys]);

  const encryptPayload = useCallback(async (text: string, roomKey: CryptoKey) => {
    return await CryptoService.encryptMessage(text, roomKey);
  }, []);

  const decryptPayload = useCallback(async (ciphertext: string, iv: string, roomKey: CryptoKey) => {
    return await CryptoService.decryptMessage(ciphertext, iv, roomKey);
  }, []);

  return { getRoomKey, encryptPayload, decryptPayload };
};
