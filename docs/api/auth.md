# Authentication API Reference

## Base URL
```
Development: http://localhost:5000/nearBy
Production: [Your Production URL]
```

## Authentication Endpoints

### Initiate Authentication
Initiates the authentication process by sending an OTP to either email or phone number.

#### `POST /auth/initiate`

#### Request Body
```json
{
  "email": "string",      // Required if authType is Email
  "phoneNo": "string",    // Required if authType is PhoneNo
  "authType": "string",   // "Email" or "PhoneNo"
  "role": "string"        // User role
}
```

#### Example Requests

##### Email Authentication
```json
{
  "email": "user@example.com",
  "authType": "Email",
  "role": "requester"
}
```

##### Phone Authentication
```json
{
  "phoneNo": "1234567890",
  "authType": "PhoneNo",
  "role": "provider"
}
```

#### Success Response (200)
```json
{
  "success": true,
  "code": 200,
  "message": "OTP sent successfully to your email",
  "user": {
    "userId": "user_id",
    "authType": "Email",
    "role": "requester || provider" ,
    "firstName": "John",
    "isNewUser": true,
    "contactOrEmail": "user@example.com",
    "status": "PENDING"
  },
  "secretKey": "generated_secret_key",
  "encryptedData": "encrypted_user_data"
}
```

#### Error Responses

##### Invalid Authentication Type (400)
```json
{
  "success": false,
  "message": "Invalid authentication type"
}
```

##### Invalid Role (400)
```json
{
  "success": false,
  "message": "Invalid user role"
}
```

##### Missing Email (400)
```json
{
  "success": false,
  "message": "Email is required for email authentication"
}
```

##### Invalid Format (400)
```json
{
  "success": false,
  "message": "Invalid email format"
}
```

##### Server Error (500)
```json
{
  "success": false,
  "message": "Failed to send OTP. Please try again."
}
```

## Implementation Details

### Authentication Flow
1. User submits email/phone with authentication type
2. System validates input format
3. Checks if user exists in database
4. Creates new user or updates existing user roles
5. Generates and sends OTP
6. Returns encrypted user data with secure key

### Validation Rules
- Email must be in valid format
- Phone number must be 10 digits
- AuthType must be either 'Email' or 'PhoneNo'
- Role must be a valid user role

### Security Measures
- OTP generation for verification
- Data encryption for sensitive information
- Role-based access control
- Status tracking for user verification

### Environment Variables
```env
NODE_ENV=development
JWT_SECRET=your_jwt_secret
MONGODB_URI=your_mongodb_uri
SMTP_HOST=your_smtp_host
SMTP_PORT=your_smtp_port
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
```

---

### Verify OTP
Verifies the OTP sent during authentication initiation and completes the authentication process.

#### `POST /auth/verify`

#### Request Body
```json
{
  "userId": "string",     // Required - User ID received from initiate auth
  "otp": "string",       // Required - OTP received via email/phone
  "authType": "string",  // Required - "Email" or "PhoneNo"
  "role": 0,            // Required - User role (0 for Provider) (1 for Requester)
  "isNewUser": boolean  // Required - Whether this is a new user
}
```

#### Example Request
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "otp": "123456",
  "authType": "Email",
  "role": 0,
  "isNewUser": false
}
```

#### Success Response (200)
```json
{
  "success": true,
  "code": 200,
  "message": "OTP verified successfully",
  "authToken": "jwt_auth_token",
  "refreshToken": "jwt_refresh_token",
  "session_id": "session_identifier",
  "encryptedUId": "encrypted_user_id",
  "encryptionKey": "encryption_key",
  "encryptedPId": "encrypted_provider_id",  // Only for providers
  "encryptionPKey": "provider_encryption_key",  // Only for providers
  "user": {
    "role": 0,
    "status": "ACTIVE",
    "firstName": "John",
    "lastName": "Doe",
    "fullName": "John Doe",
    "authType": "Email"
  }
}
```

#### Error Responses

##### Missing Required Fields (400)
```json
{
  "success": false,
  "message": "User ID, OTP, and auth type are required"
}
```

##### User Not Found (404)
```json
{
  "success": false,
  "message": "User not found"
}
```

##### Invalid OTP (400)
```json
{
  "success": false,
  "message": "Error while verifying otp"
}
```

##### Provider Not Found (404)
```json
{
  "success": false,
  "message": "Provider not found"
}
```

##### Server Error (500)
```json
{
  "success": false,
  "message": "Failed to verify OTP"
}
```

#### Cookies Set
|
 Cookie Name 
|
 Description 
|
 Configuration 
|
|
-------------
|
-------------
|
---------------
|
|
 auth_token 
|
 JWT authentication token 
|
 HTTP Only, Secure 
|
|
 refresh_token 
|
 JWT refresh token 
|
 HTTP Only, Secure 
|
|
 session_id 
|
 Session identifier 
|
 Secure, SameSite 
|
|
 uid 
|
 Encrypted user ID 
|
 HTTP Only, Secure 
|
|
 diukey 
|
 User ID encryption key 
|
 HTTP Only, Secure 
|
|
 puid 
|
 Encrypted provider ID (providers only) 
|
 HTTP Only, Secure 
|
|
 puidkey 
|
 Provider ID encryption key (providers only) 
|
 HTTP Only, Secure 
|

### Implementation Details

#### Authentication Flow
1. User submits OTP with user ID and authentication type
2. System validates required fields
3. Verifies user exists in database
4. Validates OTP using OTPService
5. For providers:
   - Checks provider status
   - Retrieves provider ID
   - Encrypts provider information
6. Generates authentication tokens
7. Sets secure cookies
8. Returns encrypted IDs and user information

#### Security Measures
- JWT-based authentication
- Secure HTTP-only cookies
- Encrypted user and provider IDs
- Session management
- Role-based authorization

#### Provider-Specific Logic
- Checks for existing provider registration
- Sets SERVICE_DETAILS_PENDING status for new providers
- Includes additional encryption for provider IDs

### Testing Notes

#### Test Cases
1. Verify with valid OTP
2. Verify with invalid OTP
3. Verify with expired OTP
4. Verify for new user
5. Verify for existing user
6. Verify for provider
7. Verify with missing fields
8. Verify with non-existent user

#### Cookie Verification
- Ensure all cookies are set with correct configurations
- Verify cookie encryption
- Test cookie expiration

---

### Resend OTP
Regenerates and resends OTP to the user's email or phone number.

#### `PATCH /auth/resendOTP`

#### Request Body
```json
{
  "userId": "string",          // Required - User ID
  "authType": "string",       // Required - "Email" or "PhoneNo"
  "isNewUser": boolean,       // Required - Whether this is a new user
  "contactOrEmail": "string", // Required - Email or phone number to send OTP
  "firstName": "string"       // Optional - User's first name for email template
}
```

#### Example Request
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "authType": "Email",
  "isNewUser": false,
  "contactOrEmail": "user@example.com",
  "firstName": "John"
}
```

#### Success Response (200)
```json
{
  "success": true,
  "otp": "123456"  // Only included in development environment
}
```

#### Error Response (500)
```json
{
  "success": false,
  "message": "Failed to generate resend OTP"
}
```

### Implementation Details

#### Resend OTP Flow
1. User requests new OTP with their userId and contact information
2. System generates new OTP using OTPService
3. OTP is sent via email or SMS based on authType
4. Development environment includes OTP in response

#### Security Considerations
- Previous OTP becomes invalid when new one is generated
- Purpose-specific OTP (LOGIN/SIGNUP)
- Delivery method matches original authentication type

### Testing Notes

#### Test Cases
1. Resend OTP for email authentication
2. Resend OTP for phone authentication
3. Resend OTP for new user
4. Resend OTP for existing user
5. Test with invalid userId
6. Test with incorrect contact information

#### Development vs Production
- Development environment returns OTP in response
- Production environment only sends OTP via email/SMS

---

### Update User Details
Updates the user's profile details. This is a protected endpoint that requires authentication and proper role authorization.

#### `PATCH /auth/details`

#### Authentication
- Requires valid JWT token in `auth_token` cookie
- Requires one of the following roles: PROVIDER, REQUESTER

#### Request Headers
```
Cookie: auth_token=<jwt_token>
```

#### Request Body
```json
{
  "firstName": "string",  // Required - User's first name
  "lastName": "string"   // Required - User's last name
}
```

#### Example Request
```json
{
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Profile details update successfully",
  "firstName": "John",
  "lastName": "Doe",
  "role": 1  // 0 for PROVIDER, 1 for REQUESTER
}
```

#### Error Responses

##### Unauthorized (401)
```json
{
  "success": false,
  "message": "Unauthorized access"
}
```

##### Invalid Role (403)
```json
{
  "success": false,
  "message": "Access forbidden"
}
```

##### Update Failed (404)
```json
{
  "success": false,
  "message": "Failed to update profile"
}
```

##### Server Error (500)
```json
{
  "success": false,
  "message": "Failed to verify OTP"
}
```

### Implementation Details

#### Authorization Flow
1. Validate JWT token using `authMiddleware`
2. Check user role using `authorize([ROLES.PROVIDER, ROLES.REQUESTER])`
3. Extract user ID and role from authenticated request
4. Update user details in database
5. Update user status based on role:
   - REQUESTER: Set to ACTIVE
   - PROVIDER: Set to SERVICE_DETAILS_PENDING

#### Status Management
- REQUESTER users become ACTIVE after details update
- PROVIDER users move to SERVICE_DETAILS_PENDING for additional verification

### Code Example

#### Making an API Request
```javascript
const response = await fetch('http://localhost:5000/api/auth/details', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json'
  },
  credentials: 'include',  // Important for sending cookies
  body: JSON.stringify({
    firstName: "John",
    lastName: "Doe"
  })
});

const data = await response.json();
```

### Testing Notes

#### Test Cases
1. Update details with valid JWT and PROVIDER role
2. Update details with valid JWT and REQUESTER role
3. Attempt update with invalid JWT
4. Attempt update with unauthorized role
5. Update with missing fields
6. Verify status changes:
   - REQUESTER → ACTIVE
   - PROVIDER → SERVICE_DETAILS_PENDING

#### Required Headers
```
Cookie: auth_token=<valid_jwt_token>
```

#### Middleware Checks
- JWT validation
- Role authorization
- User existence

---

*Last Updated: 14-02-2025*