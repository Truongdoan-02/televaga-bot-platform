export interface TelegramMedia { fileId: string; fileName: string; mimeType: string; fileSize?: number; type: 'image' | 'video' | 'document' | 'audio' }
export function telegramMedia(message: any): TelegramMedia | null {
  const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null;
  if (photo?.file_id) return { fileId: photo.file_id, fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: photo.file_size, type: 'image' };
  for (const [field, type, name, mime] of [
    ['video', 'video', 'video.mp4', 'video/mp4'], ['animation', 'video', 'animation.mp4', 'video/mp4'],
    ['document', 'document', 'document', 'application/octet-stream'], ['audio', 'audio', 'audio.mp3', 'audio/mpeg'],
    ['video_note', 'video', 'video-note.mp4', 'video/mp4'], ['voice', 'audio', 'voice.ogg', 'audio/ogg'], ['sticker', 'image', 'sticker.webp', 'image/webp'],
  ] as const) {
    const file = message[field];
    if (!file?.file_id) continue;
    const fileName = String(file.file_name || name);
    const mimeType = String(file.mime_type || mime).toLowerCase();
    const documentType = mimeType.startsWith('image/') ? 'image'
      : mimeType.startsWith('video/') ? 'video'
      : mimeType.startsWith('audio/') ? 'audio'
      : /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(fileName) ? 'image'
      : /\.(mp4|webm|mov|m4v)$/i.test(fileName) ? 'video'
      : /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus)$/i.test(fileName) ? 'audio' : 'document';
    return { fileId: file.file_id, fileName: String(file.file_name || name), mimeType: file.mime_type || mime, fileSize: file.file_size, type: field === 'document' ? documentType : field === 'sticker' && file.is_animated ? 'document' : field === 'sticker' && file.is_video ? 'video' : type };
  }
  return null;
}
