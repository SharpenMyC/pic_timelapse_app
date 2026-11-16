const photoInput = document.querySelector('#photoInput');
const dropZone = document.querySelector('#dropZone');
const timelineList = document.querySelector('#timelineList');
const emptyState = document.querySelector('#emptyState');
const photoCount = document.querySelector('#photoCount');
const exportButton = document.querySelector('#exportButton');
const exportButtonText = document.querySelector('#exportButtonText');
const exportSummary = document.querySelector('#exportSummary');
const exportProgress = document.querySelector('#exportProgress');
const progressFill = document.querySelector('#progressFill');
const progressText = document.querySelector('#progressText');
const previewImage = document.querySelector('#previewImage');
const previewPlaceholder = document.querySelector('#previewPlaceholder');
const previewDate = document.querySelector('#previewDate');
const previewPosition = document.querySelector('#previewPosition');
const prevButton = document.querySelector('#prevButton');
const nextButton = document.querySelector('#nextButton');
const playPreviewButton = document.querySelector('#playPreviewButton');
const fpsSelect = document.querySelector('#fpsSelect');
const totalTimeInput = document.querySelector('#totalTimeInput');
const shapeSelect = document.querySelector('#shapeSelect');
const toast = document.querySelector('#toast');

let photos = [];
let selectedPhotoId = null;
let toastTimer;
let isExporting = false;
let previewTimer;

function localDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readableDate(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, options) : 'Date not set';
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function parseExifDate(value) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readExifDate(file) {
  if (!/jpe?g$/i.test(file.name)) return null;
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;

    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xda || marker === 0xd9) break;
      const segmentLength = view.getUint16(offset + 2);
      const segmentStart = offset + 4;
      if (segmentLength < 2 || segmentStart + segmentLength - 2 > view.byteLength) break;

      if (marker === 0xe1 && segmentLength >= 14) {
        const signature = String.fromCharCode(...new Uint8Array(buffer, segmentStart, 6));
        if (signature !== 'Exif\0\0') return null;
        const tiff = segmentStart + 6;
        const byteOrder = view.getUint16(tiff);
        const littleEndian = byteOrder === 0x4949;
        if (!littleEndian && byteOrder !== 0x4d4d) return null;
        const read16 = (position) => view.getUint16(position, littleEndian);
        const read32 = (position) => view.getUint32(position, littleEndian);
        const readTagDate = (ifdOffset, targetTag) => {
          const ifd = tiff + ifdOffset;
          if (ifd < tiff || ifd + 2 > segmentStart + segmentLength - 2) return null;
          const entries = read16(ifd);
          for (let index = 0; index < entries; index += 1) {
            const entry = ifd + 2 + index * 12;
            if (entry + 12 > segmentStart + segmentLength - 2) break;
            if (read16(entry) !== targetTag) continue;
            const type = read16(entry + 2);
            const count = read32(entry + 4);
            if (type !== 2 || count < 1 || count > 40) return null;
            const dataOffset = count <= 4 ? entry + 8 : tiff + read32(entry + 8);
            if (dataOffset < tiff || dataOffset + count > segmentStart + segmentLength - 2) return null;
            let text = '';
            for (let char = 0; char < count; char += 1) {
              const code = view.getUint8(dataOffset + char);
              if (code === 0) break;
              text += String.fromCharCode(code);
            }
            return text;
          }
          return null;
        };
        const rootIfd = read32(tiff + 4);
        const exifPointer = (() => {
          const ifd = tiff + rootIfd;
          if (ifd + 2 > segmentStart + segmentLength - 2) return null;
          const entries = read16(ifd);
          for (let index = 0; index < entries; index += 1) {
            const entry = ifd + 2 + index * 12;
            if (entry + 12 > segmentStart + segmentLength - 2) break;
            if (read16(entry) === 0x8769) return read32(entry + 8);
          }
          return null;
        })();
        const original = exifPointer ? readTagDate(exifPointer, 0x9003) : null;
        const fallback = readTagDate(rootIfd, 0x0132);
        return parseExifDate(original || fallback || '');
      }
      offset = segmentStart + segmentLength - 2;
    }
  } catch (error) {
    console.info('Could not read photo metadata; using the file date instead.', error);
  }
  return null;
}

function getSortedPhotos() {
  return [...photos].sort((a, b) => {
    const first = a.date ? new Date(a.date).getTime() : Number.POSITIVE_INFINITY;
    const second = b.date ? new Date(b.date).getTime() : Number.POSITIVE_INFINITY;
    return first - second || a.name.localeCompare(b.name);
  });
}

function minimumDuration() {
  return Math.max(1, photos.length / Number(fpsSelect.value));
}

function requestedDuration() {
  const parsed = totalTimeInput.value.trim() ? Number(totalTimeInput.value) : 8;
  return Number.isFinite(parsed) ? Math.max(parsed, minimumDuration(), 0.1) : Math.max(8, minimumDuration());
}

function actualDuration() {
  const fps = Number(fpsSelect.value);
  const totalFrames = Math.max(photos.length, Math.round(fps * requestedDuration()));
  return totalFrames / fps;
}

function updatePreviewTimer() {
  if (!previewTimer) return;
  clearInterval(previewTimer);
  previewTimer = setInterval(() => stepPreview(1), (requestedDuration() / Math.max(photos.length, 1)) * 1000);
}

function makePhotoCard(photo) {
  const card = document.createElement('article');
  card.className = `photo-card${photo.id === selectedPhotoId ? ' selected' : ''}`;
  card.dataset.photoId = photo.id;

  const image = document.createElement('img');
  image.className = 'photo-thumb';
  image.src = photo.url;
  image.alt = '';

  const info = document.createElement('div');
  info.className = 'photo-info';
  const name = document.createElement('div');
  name.className = 'photo-name';
  name.textContent = photo.name;
  name.title = photo.name;
  const label = document.createElement('div');
  label.className = 'photo-date-label';
  label.textContent = readableDate(photo.date);
  info.append(name, label);

  const dateInput = document.createElement('input');
  dateInput.className = 'date-input';
  dateInput.type = 'datetime-local';
  dateInput.value = photo.date;
  dateInput.setAttribute('aria-label', `Date and time for ${photo.name}`);
  dateInput.addEventListener('change', () => {
    const current = photos.find((item) => item.id === photo.id);
    if (!current) return;
    current.date = dateInput.value;
    render();
  });

  const remove = document.createElement('button');
  remove.className = 'remove-button';
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = `Remove ${photo.name}`;
  remove.setAttribute('aria-label', `Remove ${photo.name}`);
  remove.addEventListener('click', () => removePhoto(photo.id));

  card.append(image, info, dateInput, remove);
  card.addEventListener('click', (event) => {
    if (event.target.closest('button, input')) return;
    selectedPhotoId = photo.id;
    render();
  });
  return card;
}

function render() {
  const sorted = getSortedPhotos();
  const minDuration = minimumDuration();
  totalTimeInput.min = String(minDuration);
  totalTimeInput.max = String(Math.max(600, minDuration));
  if (document.activeElement !== totalTimeInput && totalTimeInput.value && Number(totalTimeInput.value) < minDuration) {
    totalTimeInput.value = String(Number(minDuration.toFixed(3)));
  }
  if (!sorted.some((photo) => photo.id === selectedPhotoId)) selectedPhotoId = sorted[0]?.id ?? null;
  timelineList.replaceChildren(...sorted.map(makePhotoCard));
  photoCount.textContent = String(photos.length);
  emptyState.hidden = photos.length > 0;
  dropZone.hidden = photos.length > 0;
  document.querySelector('#addMoreButton').style.display = photos.length ? 'inline-flex' : 'none';
  exportButton.disabled = photos.length === 0 || isExporting;
  prevButton.disabled = sorted.length < 2;
  nextButton.disabled = sorted.length < 2;
  playPreviewButton.disabled = sorted.length < 2;
  if (sorted.length < 2 && previewTimer) {
    clearInterval(previewTimer);
    previewTimer = null;
    playPreviewButton.innerHTML = '<span aria-hidden="true">▷</span> Play preview';
  }

  const selectedIndex = sorted.findIndex((photo) => photo.id === selectedPhotoId);
  const current = sorted[selectedIndex];
  previewPosition.textContent = current ? `${selectedIndex + 1} / ${sorted.length}` : '0 / 0';
  if (current) {
    previewPlaceholder.hidden = true;
    previewImage.hidden = false;
    previewImage.src = current.url;
    previewDate.hidden = false;
    previewDate.querySelector('strong').textContent = readableDate(current.date);
  } else {
    previewPlaceholder.hidden = false;
    previewImage.hidden = true;
    previewImage.removeAttribute('src');
    previewDate.hidden = true;
  }

  const seconds = actualDuration();
  exportSummary.textContent = photos.length
    ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} · about ${seconds.toFixed(1)} seconds total`
    : 'Your garden’s next chapter is one click away.';
  updatePreviewTimer();
}

function removePhoto(id) {
  const photo = photos.find((item) => item.id === id);
  if (!photo) return;
  URL.revokeObjectURL(photo.url);
  photos = photos.filter((item) => item.id !== id);
  if (selectedPhotoId === id) selectedPhotoId = null;
  render();
}

async function addFiles(fileList) {
  const imageFiles = [...fileList].filter((file) => file.type.startsWith('image/'));
  if (!imageFiles.length) {
    showToast('Choose image files to add to your timeline.');
    return;
  }

  for (const file of imageFiles) {
    const exifDate = await readExifDate(file);
    const date = exifDate || new Date(file.lastModified || Date.now());
    photos.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      name: file.name,
      url: URL.createObjectURL(file),
      date: localDateTime(date),
    });
  }
  if (!selectedPhotoId && photos.length) selectedPhotoId = getSortedPhotos()[0].id;
  render();
  updatePreviewTimer();
  showToast(`${imageFiles.length} ${imageFiles.length === 1 ? 'photo added' : 'photos added'} to your garden.`);
}

function stepPreview(direction) {
  const sorted = getSortedPhotos();
  if (sorted.length < 2) return;
  let index = sorted.findIndex((photo) => photo.id === selectedPhotoId);
  index = (index + direction + sorted.length) % sorted.length;
  selectedPhotoId = sorted[index].id;
  render();
}

function canvasDimensions(shape) {
  if (shape === 'square') return [1080, 1080];
  if (shape === 'portrait') return [1080, 1920];
  return [1920, 1080];
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('One of the selected images could not be loaded.'));
    image.src = url;
  });
}

function drawFrame(context, image, photo, width, height) {
  context.fillStyle = '#e8ede2';
  context.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  const margin = Math.round(width * 0.025);
  const boxHeight = Math.round(height * 0.09);
  const dateLabel = readableDate(photo.date);
  context.font = `600 ${Math.round(height * 0.027)}px sans-serif`;
  const boxWidth = Math.min(Math.round(width * 0.68), Math.round(context.measureText(dateLabel).width + margin * 1.3));
  const boxX = margin;
  const boxY = height - margin - boxHeight;
  context.fillStyle = 'rgba(249, 249, 240, 0.88)';
  context.beginPath();
  context.roundRect(boxX, boxY, boxWidth, boxHeight, Math.round(boxHeight * 0.16));
  context.fill();
  context.fillStyle = '#354a35';
  context.textBaseline = 'middle';
  context.fillText(dateLabel, boxX + margin * 0.65, boxY + boxHeight / 2, boxWidth - margin);
}

function supportedVideoType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function exportTimelapse() {
  if (photos.length === 0 || isExporting) return;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    showToast('Video export needs a recent Chrome, Edge, or Firefox browser.');
    return;
  }
  const sorted = getSortedPhotos();
  const fps = Number(fpsSelect.value);
  const totalFrames = Math.max(sorted.length, Math.round(fps * requestedDuration()));
  const [width, height] = canvasDimensions(shapeSelect.value);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    showToast('This browser could not prepare the video canvas.');
    return;
  }

  isExporting = true;
  exportButton.disabled = true;
  exportButtonText.textContent = 'Creating your timelapse…';
  exportProgress.hidden = false;
  progressFill.style.width = '0%';
  progressText.textContent = 'Preparing your video…';
  const stream = canvas.captureStream(fps);
  const recordedChunks = [];
  let recorder;

  try {
    const mimeType = supportedVideoType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) recordedChunks.push(event.data);
    });
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', () => reject(new Error('The browser could not finish recording the video.')), { once: true });
    });
    recorder.start(250);
    const frameDelay = 1000 / fps;
    let completedFrames = 0;

    for (let photoIndex = 0; photoIndex < sorted.length; photoIndex += 1) {
      const photo = sorted[photoIndex];
      const firstFrame = Math.floor((photoIndex * totalFrames) / sorted.length);
      const lastFrame = Math.floor(((photoIndex + 1) * totalFrames) / sorted.length);
      const framesForPhoto = lastFrame - firstFrame;
      const image = await loadImage(photo.url);
      for (let frame = 0; frame < framesForPhoto; frame += 1) {
        drawFrame(context, image, photo, width, height);
        completedFrames += 1;
        progressFill.style.width = `${Math.round((completedFrames / totalFrames) * 100)}%`;
        progressText.textContent = `Growing your movie… ${Math.round((completedFrames / totalFrames) * 100)}%`;
        await new Promise((resolve) => setTimeout(resolve, frameDelay));
      }
    }

    recorder.stop();
    await stopped;
    const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'video/webm' });
    if (!blob.size) throw new Error('The browser created an empty video. Please try again.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `garden-timelapse-${new Date().toISOString().slice(0, 10)}.webm`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    progressText.textContent = 'Your garden movie is ready!';
    showToast('Your timelapse has been downloaded.');
  } catch (error) {
    if (recorder?.state === 'recording') recorder.stop();
    console.error(error);
    showToast(error instanceof Error ? error.message : 'Something went wrong while making your video.');
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    isExporting = false;
    exportButton.disabled = photos.length === 0;
    exportButtonText.textContent = 'Create my timelapse';
    setTimeout(() => { exportProgress.hidden = true; }, 3500);
  }
}

photoInput.addEventListener('change', async (event) => {
  await addFiles(event.target.files);
  photoInput.value = '';
});
document.querySelector('#topAddButton').addEventListener('click', () => photoInput.click());
document.querySelector('#addMoreButton').addEventListener('click', () => photoInput.click());
document.querySelector('#sortButton').addEventListener('click', () => {
  photos.sort((a, b) => {
    const first = a.date ? new Date(a.date).getTime() : Number.POSITIVE_INFINITY;
    const second = b.date ? new Date(b.date).getTime() : Number.POSITIVE_INFINITY;
    return first - second;
  });
  render();
  showToast('Photos are arranged from oldest to newest.');
});
prevButton.addEventListener('click', () => stepPreview(-1));
nextButton.addEventListener('click', () => stepPreview(1));
playPreviewButton.addEventListener('click', () => {
  if (previewTimer) {
    clearInterval(previewTimer);
    previewTimer = null;
    playPreviewButton.innerHTML = '<span aria-hidden="true">▷</span> Play preview';
    return;
  }
  playPreviewButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause preview';
  updatePreviewTimer();
});
exportButton.addEventListener('click', exportTimelapse);
totalTimeInput.addEventListener('input', () => {
  render();
  updatePreviewTimer();
});
totalTimeInput.addEventListener('change', () => {
  const minDuration = minimumDuration();
  if (!Number.isFinite(Number(totalTimeInput.value)) || Number(totalTimeInput.value) < minDuration) {
    totalTimeInput.value = String(Number(minDuration.toFixed(3)));
    if (photos.length) showToast(`With ${photos.length} photos, total time must be at least ${minDuration.toFixed(1)} seconds at this frame rate.`);
  }
  render();
  updatePreviewTimer();
});
fpsSelect.addEventListener('change', () => {
  render();
  updatePreviewTimer();
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}
dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    photoInput.click();
  }
});

window.addEventListener('beforeunload', () => {
  clearInterval(previewTimer);
  photos.forEach((photo) => URL.revokeObjectURL(photo.url));
});

render();
