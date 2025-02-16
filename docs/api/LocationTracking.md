# Provider Location Tracking API Documentation

## Start Location Tracking Endpoint

### Overview
This endpoint initiates location tracking for a provider, validating their location against their base location and managing their active status through Redis.

### Endpoint Details
**URL:** `/provider/location/start/:providerId`  
**Method:** `POST`  
**Authentication:** Required (JWT)  
**Authorization:** Required (PROVIDER role)

### Path Parameters
- `providerId`: The unique identifier of the provider

### Request Body
```json
{
  "latitude": number,
  "longitude": number,
  "accuracy": number,
  "source": string
}
```

### Success Response
**Code:** 200 OK
```json
{
  "success": true,
  "message": "Location tracking started"
}
```

### Error Responses

**Code:** 400 Bad Request
```json
{
  "error": "Provider already has an active session"
}
```

**Code:** 400 Bad Request
```json
{
  "error": "Provider base location not found"
}
```

**Code:** 400 Bad Request
```json
{
  "error": "Current location is outside the allowed radius of 10km from base location. Distance: {distance}km"
}
```

## Process Flow

1. **Location Service Initialization**
   - Checks if location service is initialized
   - Initializes service if not already done

2. **Parameter Processing**
   - Extracts provider ID from URL parameters
   - Parses location coordinates from request body

3. **Session Validation**
   - Checks Redis for existing active session
   - Prevents duplicate active sessions

4. **Base Location Verification**
   - Retrieves provider's base location from database
   - Validates existence of base location

5. **Distance Calculation**
   - Calculates distance between current and base location
   - Enforces maximum allowed distance (10km)

6. **Location Tracking Initialization**
   - Stores location data in Redis
   - Updates provider's active status
   - Adds location to geo-spatial index

## Technical Implementation

### Distance Calculation
The system uses a dual-approach distance calculation:

1. **Primary Method: Redis-based Calculation**
```typescript
try {
    return await redisBasedCalculation(point1, point2);
} catch (error) {
    // Fallback to Haversine calculation
}
```

2. **Fallback Method: Haversine Formula**
- Used when Redis calculation fails
- Provides accurate Earth-surface distance calculations

### Redis Data Structure

#### Provider Status Hash
Key: `provider:{providerId}`
```json
{
  "location": "{
    longitude: number,
    latitude: number,
    accuracy: number,
    source: string,
    timestamp: number,
    updatedAt: date
  }",
  "lastUpdate": timestamp,
  "startTime": timestamp,
  "status": "active"
}
```

#### Geospatial Index
Key: `provider:locations`
- Stores provider locations for spatial queries
- Enables efficient nearby provider searches

### Location Initialization Process
```typescript
const locationData = {
  coordinates: [longitude, latitude],
  accuracy: number,
  source: string,
  timestamp: Date.now(),
  updatedAt: new Date()
}
```

## Validation Rules

1. **Active Session Check**
   - Only one active session allowed per provider
   - Existing sessions must be ended before starting new ones

2. **Location Constraints**
   - Maximum allowed distance: 10km from base location
   - Valid coordinate ranges:
     - Latitude: -90 to 90
     - Longitude: -180 to 180

3. **Base Location Requirements**
   - Must exist in database
   - Must contain valid coordinates

## Error Handling

1. **Redis Initialization Errors**
   - Checks for Redis client availability
   - Provides clear error messages for connection issues

2. **Location Validation Errors**
   - Validates coordinate formats
   - Enforces distance constraints
   - Handles missing or invalid base locations

3. **Transaction Errors**
   - Validates Redis transaction results
   - Ensures all operations succeed or none

## Performance Considerations

1. **Redis Usage**
   - Optimizes for quick location queries
   - Maintains real-time tracking capabilities
   - Provides fast geospatial operations

2. **Distance Calculations**
   - Primary Redis-based calculation for efficiency
   - Haversine formula fallback for reliability
   - Cached calculations when possible

## Dependencies
- Redis for real-time location tracking
- MongoDB for provider data storage
- JWT service for authentication
- Geospatial calculation utilities

## Notes
- Location updates are timestamped automatically
- Redis transactions ensure data consistency
- Geospatial indexing enables efficient nearby searches
- System includes automatic fallback for distance calculations