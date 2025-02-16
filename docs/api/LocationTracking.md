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

## Update Location Endpoint

### Overview
This endpoint allows real-time updating of a provider's location during an active tracking session.

### Endpoint Details
**URL:** `/provider/location/update/:providerId`  
**Method:** `PATCH`  
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
  "message": "Location updated successfully"
}
```

### Error Responses

**Code:** 400 Bad Request
```json
{
  "error": "No active session found"
}
```

**Code:** 500 Internal Server Error
```json
{
  "error": "Failed to update location"
}
```

## Process Flow

1. **Service Validation**
   - Checks if location service is initialized
   - Initializes service if necessary

2. **Session Verification**
   - Verifies provider has an active tracking session
   - Checks status in Redis

3. **Location Update**
   - Updates provider's current location in Redis
   - Updates geospatial index
   - Updates last update timestamp

## Technical Implementation

### Location Update Process
```typescript
const locationData = {
  ...location,
  timestamp: Date.now(),
  updatedAt: new Date()
};
```

### Redis Operations
The update process executes two operations atomically:

1. **Hash Update**
```typescript
redis.hset(
  `provider:${providerId}`,
  'location', JSON.stringify(locationData),
  'lastUpdate', Date.now()
)
```

2. **Geospatial Index Update**
```typescript
redis.geoadd(
  'provider:locations',
  location.longitude,
  location.latitude,
  providerId
)
```

## Data Structure

### Updated Location Data
```typescript
interface LocationDetails {
  longitude: number;
  latitude: number;
  accuracy: number;
  source: string;
  timestamp: number;
  updatedAt: Date;
}
```

### Redis Storage Format
Key: `provider:{providerId}`
```json
{
  "location": "{LocationDetails}",
  "lastUpdate": timestamp
}
```

## Validation Rules

1. **Session Status**
   - Must have an active tracking session
   - Status must be 'active' in Redis

2. **Location Data**
   - Valid coordinate ranges:
     - Latitude: -90 to 90
     - Longitude: -180 to 180
   - Required fields: latitude, longitude, accuracy, source

## Error Handling

1. **Session Validation**
   - Checks for active session status
   - Returns appropriate error if session is not active

2. **Redis Operations**
   - Handles Redis transaction failures
   - Ensures atomic updates
   - Provides clear error messages

3. **Data Validation**
   - Validates coordinate formats
   - Ensures all required fields are present

## Performance Considerations

1. **Redis Transactions**
   - Uses multi-exec for atomic operations
   - Ensures data consistency
   - Minimizes race conditions

2. **Data Storage**
   - Optimized for frequent updates
   - Maintains real-time tracking capability
   - Efficient geospatial indexing

3. **Update Frequency**
   - Designed for high-frequency updates
   - Optimized for low-latency operations

## Integration with Tracking System

1. **Session Management**
   - Coordinates with tracking start/stop operations
   - Maintains session state consistency

2. **Location History**
   - Updates current location
   - Maintains last update timestamp
   - Preserves tracking continuity

## Dependencies
- Redis for real-time location storage
- JWT service for authentication
- Location tracking service

## Notes
- Updates are atomic operations
- Timestamps are automatically managed
- Geospatial index is maintained for location queries
- Session status must be verified before updates
- All updates include source tracking for audit purposes

## Error Scenarios

1. **Invalid Session**
   - Occurs when updating location without active session
   - Requires session restart

2. **Redis Failures**
   - Transaction failures
   - Connection issues
   - Data consistency errors

3. **Invalid Location Data**
   - Coordinate validation failures
   - Missing required fields
   - Format issues

## Best Practices

1. **Update Frequency**
   - Implement reasonable update intervals
   - Consider battery optimization
   - Balance accuracy vs resource usage

2. **Error Recovery**
   - Implement retry logic for failed updates
   - Handle session recovery gracefully
   - Maintain data consistency

3. **Data Validation**
   - Validate coordinates before update
   - Verify session status
   - Ensure data completeness

## Stop Tracking Endpoint

### Overview
This endpoint terminates an active location tracking session for a provider, saving the final location to MongoDB and cleaning up Redis data.

### Endpoint Details
**URL:** `/provider/location/stop/:providerId`  
**Method:** `POST`  
**Authentication:** Required (JWT)  
**Authorization:** Required (PROVIDER role)

### Path Parameters
- `providerId`: The unique identifier of the provider

### Success Response
**Code:** 200 OK
```json
{
  "success": true,
  "message": "Shift ended successfully"
}
```

### Error Responses

**Code:** 400 Bad Request
```json
{
  "error": "No active session found"
}
```

**Code:** 400 Bad Request
```json
{
  "error": "No location data found"
}
```

**Code:** 500 Internal Server Error
```json
{
  "error": "Redis client not initialized"
}
```

**Code:** 500 Internal Server Error
```json
{
  "error": "Failed to update provider location in MongoDB"
}
```

**Code:** 500 Internal Server Error
```json
{
  "error": "Failed to cleanup Redis data"
}
```

## Process Flow

1. **Service Validation**
   - Verifies Redis client initialization
   - Checks for active tracking session

2. **Location Data Retrieval**
   - Fetches current location data from Redis
   - Validates location data existence

3. **MongoDB Update**
   - Converts Redis location data to MongoDB format
   - Updates provider's location in MongoDB
   - Sets isActive status to false

4. **Redis Cleanup**
   - Removes provider data from Redis hash
   - Removes provider from geospatial index
   - Executes cleanup operations atomically

## Technical Implementation

### Location Data Transformation
```typescript
const currentLocationData = {
  currentLocation: {
    type: "Point",
    coordinates: [longitude, latitude],
    source: string,
    accuracy: number,
    lastUpdated: Date
  },
  isActive: false
}
```

### MongoDB Update Operation
```typescript
await ProviderLocation.findOneAndUpdate(
  { providerId: new ObjectId(providerId) },
  { $set: currentLocationData },
  { new: true }
);
```

### Redis Cleanup Operations
```typescript
redis.multi()
  .del(`provider:${providerId}`)
  .zrem('provider:locations', providerId)
  .exec();
```

## Data Flow

1. **Data Retrieval**
   - Fetches location data from Redis hash
   - Parses JSON location data

2. **Data Transformation**
   - Converts coordinates to GeoJSON Point format
   - Preserves source and accuracy information
   - Updates timestamp information

3. **Data Persistence**
   - Saves final location to MongoDB
   - Removes temporary Redis data

## Validation Rules

1. **Session Validation**
   - Must have an active session in Redis
   - Must have existing location data

2. **Data Integrity**
   - Valid coordinate formats
   - Complete location information
   - Proper timestamp data

## Error Handling

1. **Initialization Errors**
   - Redis client availability
   - Service initialization status

2. **Session Errors**
   - Missing active session
   - Invalid session status

3. **Data Errors**
   - Missing location data
   - Invalid data format
   - MongoDB update failures
   - Redis cleanup failures

## Data Cleanup Process

1. **MongoDB Update**
   - Updates final location
   - Marks provider as inactive
   - Preserves location history

2. **Redis Cleanup**
   - Removes provider hash data
   - Removes from geospatial index
   - Ensures atomic operations

## Performance Considerations

1. **Transaction Management**
   - Atomic Redis operations
   - MongoDB update optimization
   - Error recovery handling

2. **Data Consistency**
   - Validates all operations
   - Maintains data integrity
   - Handles cleanup failures

## Dependencies
- Redis for session management
- MongoDB for persistent storage
- JWT service for authentication
- ObjectId for MongoDB operations

## Best Practices

1. **Error Recovery**
   - Implement proper error logging
   - Handle cleanup failures gracefully
   - Maintain data consistency

2. **Data Validation**
   - Verify data completeness
   - Validate coordinate formats
   - Ensure proper timestamps

3. **Resource Management**
   - Clean up Redis resources
   - Update MongoDB efficiently
   - Handle connections properly

## Notes
- Always verify active session before stopping
- Ensure proper data transformation
- Handle cleanup operations atomically
- Maintain audit trail of location updates