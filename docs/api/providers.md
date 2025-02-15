# Provider Creation API Documentation

## Overview
This document details the Provider Creation API endpoint which handles the registration of service providers in the system, including their service selections and location details.

## Endpoint Details

### Create Provider
Creates a new provider profile with associated location and service information.

**URL:** `/provider`  
**Method:** `POST`  
**Authentication:** Required (JWT)  
**Authorization:** Required (PROVIDER role)

### Request Headers
```
Authorization: Bearer <jwt_token>
```

### Request Body
```json
{
  "selectedServices": ["service1", "service2", ...],
  "locationDetails": {
    "coordinates": [longitude, latitude],
    "address": "string",
    // Additional location properties
  }
}
```

### Success Response
**Code:** 201 Created
```json
{
  "success": true,
  "message": "Provider created successfully",
  "encryptedPId": "string",
  "encryptionPKey": "string"
}
```

### Error Response
**Code:** 500 Internal Server Error
```json
{
  "success": false,
  "message": "Internal server error",
  "error": "Error details (only in development mode)"
}
```

## Process Flow

1. **Authentication & Authorization**
   - Request is authenticated using JWT middleware
   - User role is verified to be PROVIDER
   - User ID is extracted from JWT token

2. **Provider Creation**
   - Creates new Provider document with:
     - User ID association
     - Selected services
     - Base location (with Point type and timestamp)

3. **Location Creation**
   - Creates new ProviderLocation document with:
     - Provider ID reference
     - Current location details
     - Active status flag

4. **User Status Update**
   - Updates associated user's status to ACTIVE
   - Confirms successful user update

5. **Provider ID Encryption**
   - Encrypts the provider ID for secure transmission
   - Generates encryption key

## Data Models

### Provider Model
```typescript
{
  userId: ObjectId,
  services: string[],
  baseLocation: {
    type: 'Point',
    coordinates: [number, number],
    address: string,
    lastUpdated: Date
  }
}
```

### ProviderLocation Model
```typescript
{
  providerId: ObjectId,
  currentLocation: {
    type: 'Point',
    coordinates: [number, number],
    address: string,
    lastUpdated: Date
  },
  isActive: boolean
}
```

## Error Handling

The API implements a robust error handling mechanism with rollback capabilities:

1. **Provider Creation Failure**
   - Logs error details
   - Returns 500 status code
   - Includes detailed error in development environment

2. **Location Creation Failure**
   - Deletes created provider document
   - Rolls back the transaction
   - Returns appropriate error response

3. **User Update Failure**
   - Deletes both provider and location documents
   - Rolls back all changes
   - Returns error response

## Security Considerations

1. **Authentication**
   - JWT-based authentication required
   - Token validation on every request

2. **Authorization**
   - Role-based access control (PROVIDER role required)
   - User ID verification

3. **Data Protection**
   - Provider ID encryption before transmission
   - Secure key generation and management

## Dependencies
- JWT Service for authentication and authorization
- MongoDB for data storage
- Encryption service for provider ID protection

## Notes
- Location data is stored in GeoJSON Point format
- Timestamps are automatically added to location updates
- Provider IDs are encrypted before sending to client
- Error details are only exposed in development environment