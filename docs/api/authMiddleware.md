# Authentication & Authorization Middleware

## Overview

The authentication system implements a token-based authentication flow using JWT tokens with session validation and role-based authorization. The system uses three tokens stored in cookies:

- `auth_token`: Short-lived JWT for API access
- `refresh_token`: Long-lived JWT for generating new auth tokens
- `session_id`: Session identifier for additional security

## Authentication Middleware

### Purpose

Validates incoming requests and handles token refresh automatically.

### Flow

1. Extracts tokens from cookies (`auth_token`, `refresh_token`, `session_id`)
2. Validates session existence in database
3. Handles three scenarios:
   - Valid auth token → Proceeds with request
   - Missing auth token → Generates new one using refresh token
   - Expired auth token → Automatically refreshes using refresh token

### Implementation

```typescript
const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const authToken = req.cookies.auth_token;
        const refreshToken = req.cookies.refresh_token;
        const sessionId = req.cookies.session_id;

        if (!refreshToken || !sessionId) {
            throw createAppError("Missing required tokens");
        }

        const session = await getSessionFromDB(sessionId);
        if (!session) {
            throw createAppError("Invalid session");
        }

        if (!authToken) {
            const decoded = await newAuthToken(refreshToken, res);
            req.user = decoded;
            return next();
        }

        try {
            const decoded = await verifyAuthToken(authToken);
            req.user = decoded;
            return next();
        } catch (tokenError) {
            if (tokenError instanceof jwt.TokenExpiredError) {
                const decoded = await newAuthToken(refreshToken, res);
                req.user = decoded;
                return next();
            }
            throw tokenError;
        }
    } catch (error: any) {
        res.clearCookie('auth_token');
        res.clearCookie('refresh_token');
        res.clearCookie('session_id');
        return res.status(401).json({
            success: false,
            message: error.message || 'Authentication failed'
        });
    }
};
```

### Error Responses

#### Missing Tokens (401)
```json
{
    "success": false,
    "message": "Missing required tokens"
}
```

#### Invalid Session (401)
```json
{
    "success": false,
    "message": "Invalid session"
}
```

## Authorization Middleware

### Purpose

Implements role-based access control (RBAC) for protected routes.

### Implementation

```typescript
const authorize = (allowedRoles: number[]): AsyncFunction => {
    return async (req: Request, res: Response, next: NextFunction): Promise => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to access this resource'
            });
        }
        next();
    };
};
```

### Usage Example

```typescript
app.use('/admin-route', 
    authMiddleware,
    authorize([ROLES.PROVIDER, ROLES.ADMIN]),
    routeHandler
);
```

### Error Responses

#### Not Authenticated (401)
```json
{
    "success": false,
    "message": "User not authenticated"
}
```

#### Unauthorized Role (403)
```json
{
    "success": false,
    "message": "Not authorized to access this resource"
}
```

## Session Management

### Database Validation

```typescript
const getSessionFromDB = async (sessionId: string) => {
    const isValid = await UserSesssion.find({ sessionId: sessionId });
    if (!isValid) {
        throw createAppError("Refresh Token Not found in DB");
    }
    return true;
}
```

## Security Features

### Token Management
- Automatic token refresh on expiration
- Session validation for each request
- Cookie security settings:
  - HTTP Only
  - Secure flag
  - Same-site policy

### Error Handling
- Automatic cookie cleanup on authentication failures
- Proper error messages for different failure scenarios
- Session invalidation on security breaches

## Testing Considerations

### Test Cases
1. Valid token authentication
2. Token refresh flow
3. Session validation
4. Role-based access
5. Error scenarios:
   - Missing tokens
   - Invalid session
   - Unauthorized roles
   - Expired tokens

### Testing Headers
```javascript
cookies: {
    auth_token: 'valid_jwt_token',
    refresh_token: 'valid_refresh_token',
    session_id: 'valid_session_id'
}
```

---

*Last Updated: [15-02-2025]*