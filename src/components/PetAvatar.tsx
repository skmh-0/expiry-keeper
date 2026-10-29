import { useEffect, useState } from 'react';
import type { Pet } from '../types';
import { getPhoto } from '../lib/storage';

export function PetAvatar({
  pet,
  size = 'md',
  className = '',
}: {
  pet: Pet;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [photo, setPhoto] = useState<string | undefined>(
    pet.avatar?.startsWith('data:image/') ? pet.avatar : undefined,
  );

  useEffect(() => {
    let cancelled = false;
    if (pet.avatar?.startsWith('data:image/')) {
      setPhoto(pet.avatar);
      return;
    }
    if (!pet.avatarPhotoId) {
      setPhoto(undefined);
      return;
    }
    setPhoto(undefined);
    void getPhoto(pet.avatarPhotoId).then((data) => {
      if (!cancelled) setPhoto(data);
    });
    return () => {
      cancelled = true;
    };
  }, [pet.avatar, pet.avatarPhotoId]);

  const fallback = pet.avatar && !pet.avatar.startsWith('data:image/')
    ? pet.avatar
    : pet.species === 'dog'
      ? '🐶'
      : pet.species === 'cat'
        ? '🐱'
        : '🐾';
  const sizeClass =
    size === 'lg'
      ? 'pet-avatar-lg'
      : size === 'sm'
        ? 'pet-avatar-sm'
        : size === 'xs'
          ? 'pet-avatar-xs'
          : '';
  return (
    <span className={`pet-avatar ${sizeClass} ${className}`.trim()} aria-label={`${pet.name}的头像`}>
      {photo ? <img src={photo} alt="" /> : fallback}
    </span>
  );
}

