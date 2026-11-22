import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, MapPin } from 'lucide-react';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { defaultDeliveryArea, deliveryAreas } from '../constants';

const markerIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const areaAliases = {
  'Quận 1': ['district 1'],
  'Quận 3': ['district 3'],
  'Bình Thạnh': ['binh thanh'],
  'Thủ Đức': ['thu duc', 'quan 2', 'district 2', 'quan 9', 'district 9'],
  'Gò Vấp': ['go vap'],
  'Tân Bình': ['tan binh'],
  'Phú Nhuận': ['phu nhuan'],
  'Quận 7': ['district 7'],
  'Quận 10': ['district 10'],
  'Bình Tân': ['binh tan'],
};

let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;

const normalizeForMatch = (value) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function findDeliveryArea(result) {
  const address = result.address || {};
  const searchableParts = [
    address.city_district,
    address.suburb,
    address.county,
    address.district,
    address.state_district,
    address.city,
    address.town,
    address.municipality,
    result.display_name,
  ]
    .filter((part) => typeof part === 'string')
    .map((part) => ` ${normalizeForMatch(part)} `);

  for (const area of deliveryAreas) {
    const aliases = [area, ...(areaAliases[area] || [])];
    if (aliases.some((alias) => {
      const normalizedAlias = ` ${normalizeForMatch(alias)} `;
      return searchableParts.some((part) => part.includes(normalizedAlias));
    })) {
      return { area, recognized: true };
    }
  }

  return { area: defaultDeliveryArea, recognized: false };
}

function reverseGeocode(latitude, longitude) {
  const request = nominatimQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNominatimRequestAt = Date.now();

    const params = new URLSearchParams({
      format: 'json',
      lat: String(latitude),
      lon: String(longitude),
      'accept-language': 'vi',
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Nominatim request failed with status ${response.status}`);
    }

    const result = await response.json();
    const address = typeof result.display_name === 'string' ? result.display_name.trim() : '';
    if (!address) throw new Error('Nominatim returned no address');
    if (address.length > 255) throw new Error('Nominatim address exceeds the allowed length');
    return { address, ...findDeliveryArea(result) };
  });

  nominatimQueue = request.then(() => undefined, () => undefined);
  return request;
}

function LocationMap({ location, onPositionChange }) {
  const container = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const onPositionChangeRef = useRef(onPositionChange);

  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  useEffect(() => {
    if (!container.current) return undefined;

    const initialPosition = [location.latitude, location.longitude];
    const mapInstance = L.map(container.current).setView(initialPosition, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapInstance);

    const markerInstance = L.marker(initialPosition, {
      draggable: true,
      icon: markerIcon,
    }).addTo(mapInstance);
    const updatePosition = (latitude, longitude) => {
      onPositionChangeRef.current(latitude, longitude);
    };

    mapInstance.on('click', (event) => {
      markerInstance.setLatLng(event.latlng);
      updatePosition(event.latlng.lat, event.latlng.lng);
    });
    markerInstance.on('dragend', () => {
      const position = markerInstance.getLatLng();
      updatePosition(position.lat, position.lng);
    });
    map.current = mapInstance;
    marker.current = markerInstance;

    return () => {
      mapInstance.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !marker.current) return;

    const position = L.latLng(location.latitude, location.longitude);
    marker.current.setLatLng(position);
    map.current.panTo(position);
  }, [location.latitude, location.longitude]);

  return (
    <div
      ref={container}
      className="h-[220px] w-full rounded-xl"
      aria-label="Bản đồ OpenStreetMap; kéo ghim hoặc chạm bản đồ để chỉnh vị trí"
    />
  );
}

function AutoLocationButton({ onLocationFound }) {
  const [acquiringPosition, setAcquiringPosition] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingLocation, setPendingLocation] = useState(null);
  const lookupRequestId = useRef(0);
  const busy = acquiringPosition || geocoding;

  const updateLocation = useCallback(async (latitude, longitude) => {
    const requestId = ++lookupRequestId.current;
    setGeocoding(true);
    setError('');
    setNotice('');
    setPendingLocation((current) => ({
      ...current,
      address: '',
      area: current?.area || defaultDeliveryArea,
      latitude,
      longitude,
    }));

    try {
      const result = await reverseGeocode(latitude, longitude);
      if (requestId !== lookupRequestId.current) return;

      setPendingLocation((current) => ({
        ...current,
        ...result,
        latitude,
        longitude,
      }));
      if (!result.recognized) {
        setNotice(`Khu vực chưa nhận diện được; tạm chọn ${defaultDeliveryArea}. Bạn có thể đổi khu vực.`);
      }
    } catch {
      if (requestId === lookupRequestId.current) {
        setError('Không thể tra cứu địa chỉ qua Nominatim. Hãy thử lại hoặc nhập địa chỉ thủ công.');
      }
    } finally {
      if (requestId === lookupRequestId.current) setGeocoding(false);
    }
  }, []);

  const handleGetLocation = () => {
    setError('');
    setNotice('');
    setPendingLocation(null);
    lookupRequestId.current += 1;

    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ định vị GPS.');
      return;
    }

    setAcquiringPosition(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setAcquiringPosition(false);
        setPendingLocation({
          address: '',
          area: defaultDeliveryArea,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        updateLocation(coords.latitude, coords.longitude);
      },
      (locationError) => {
        setAcquiringPosition(false);
        if (locationError.code === 1) {
          setError('Bạn đã từ chối quyền truy cập vị trí.');
        } else if (locationError.code === 3) {
          setError('Định vị quá thời gian chờ. Vui lòng thử lại.');
        } else {
          setError('Không thể xác định vị trí hiện tại.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const cancelLocation = () => {
    lookupRequestId.current += 1;
    setPendingLocation(null);
    setGeocoding(false);
    setError('');
    setNotice('');
  };

  const confirmLocation = () => {
    if (!pendingLocation?.address || busy) return;

    onLocationFound(pendingLocation);
    setPendingLocation(null);
    setNotice(`Đã xác nhận vị trí giao hàng tại ${pendingLocation.area}.`);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleGetLocation}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MapPin className="h-4 w-4" />
        )}
        {busy ? 'Đang định vị...' : 'Định vị tự động'}
      </button>
      <p className="text-xs text-slate-500">
        Tọa độ GPS sẽ được gửi đến Nominatim để tra cứu địa chỉ.{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          © OpenStreetMap contributors
        </a>
      </p>
      {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
      {notice && <p className="text-xs text-emerald-700" role="status">{notice}</p>}
      {pendingLocation && (
        <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3" aria-labelledby="location-confirmation-title">
          <h3 id="location-confirmation-title" className="font-semibold text-slate-800">
            Xác nhận vị trí giao hàng
          </h3>
          <LocationMap location={pendingLocation} onPositionChange={updateLocation} />
          {geocoding ? (
            <p className="text-sm text-slate-600">Đang cập nhật địa chỉ từ vị trí mới...</p>
          ) : (
            <p className="text-sm text-slate-700">{pendingLocation.address || 'Chưa có địa chỉ.'}</p>
          )}
          <p className="text-xs text-slate-600">
            Khu vực: {pendingLocation.area}
            {notice && ' (khu vực mặc định; bạn có thể thay đổi trong danh sách)'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmLocation}
              disabled={busy || !pendingLocation.address}
              className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Xác nhận vị trí
            </button>
            <button
              type="button"
              onClick={cancelLocation}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export default AutoLocationButton;
