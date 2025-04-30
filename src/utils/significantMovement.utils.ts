export function isSignificantMovement({
    oldLat,
    oldLng,
    newLat,
    newLng,
    minDistanceMeters = 1
}: {
    oldLat: number;
    oldLng: number;
    newLat: number;
    newLng: number;
    minDistanceMeters?: number;
}): boolean {
    // Haversine formula to calculate distance
    const R = 6371e3; // Earth radius in meters
    const φ1 = oldLat * Math.PI / 180;
    const φ2 = newLat * Math.PI / 180;
    const Δφ = (newLat - oldLat) * Math.PI / 180;
    const Δλ = (newLng - oldLng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance > minDistanceMeters;
}