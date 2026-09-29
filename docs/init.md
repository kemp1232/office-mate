You are Claude Code working inside a BRAND-NEW / EMPTY repository.

We are building an internal First Mate Technologies application:

FIRST MATE GEOFENCED ATTENDANCE

This is a real internal application intended to be deployed to Vercel and primarily used by First Mate team members on their PHONES.

The primary real-world usage is:

Team Member takes out phone
-> scans the office QR code
-> Attendance PWA opens
-> authenticates if needed
-> app determines whether today's valid action is Clock In or Clock Out
-> user taps that action
-> browser requests current location
-> server validates GPS accuracy and office geofence
-> attendance event is recorded

This mobile flow is the PRIMARY product experience.

Desktop is secondary and is mostly important for:

- Admin Settings
- configuring the office location
- viewing/printing the QR shortcut
- general setup

Do NOT design a desktop application and then merely shrink it for phones.

==================================================
WORKING STYLE
==================================================

Start by researching and planning.

DO NOT immediately begin implementation.

Follow this workflow:

1. Explore / research
2. Plan
3. Present the implementation plan to me
4. Wait for my approval
5. Implement in coherent milestones
6. Test
7. Run and visually verify the actual application
8. Perform security/code-quality reviews
9. Provide final setup and deployment instructions

Use CURRENT official documentation rather than relying only on model memory.

For non-blocking implementation details:

- make a sensible engineering decision
- document the decision
- continue

Only ask me questions if the answer would materially change:

- product scope
- core architecture
- authentication/security model
- fundamental database design
- deployment architecture
- a significant paid/external dependency

Do NOT interrupt implementation for small questions such as:

- component naming
- folder naming
- minor spacing choices
- exact library choices where several reasonable options exist
- minor visual details
- trivial implementation details

Make a sensible choice and continue.

Do NOT add useful-sounding features that are outside the defined v1 scope.

==================================================
SOURCE OF TRUTH
==================================================

When requirements appear to conflict, use this priority:

1. Explicit requirements in THIS prompt
2. The approved First Mate Geofenced Attendance proposal
3. First Mate's current website as the visual/design reference
4. Earlier ideas only when they are not contradicted by the above

Do not silently reinterpret conflicting requirements.

==================================================
PRODUCT GOAL
==================================================

Replace First Mate's current Google Form attendance workflow with a fast, identity-verified, location-verified Clock In / Clock Out application.

The previous process has these problems:

- typed email does not prove physical presence
- somebody can submit a form from outside the office
- somebody could enter another person's email
- a spreadsheet row does not explain how attendance was validated

The new application's goal is:

A fast Clock In / Clock Out experience that verifies who the user is and verifies that they are within the configured First Mate office area at the exact moment they perform the attendance action.

IMPORTANT:

The application must NEVER continuously track a user's location.

Location is requested ONLY when the user explicitly attempts to Clock In or Clock Out.

==================================================
TECH STACK
==================================================

Required:

- Next.js
- TypeScript
- Supabase
  - PostgreSQL
  - Supabase Auth
- Google OAuth / Google Workspace SSO for normal Team Members
- Vercel
- installable PWA

Use the current stable production-supported versions at implementation time.

Before selecting implementation patterns, read the current official documentation for:

- Next.js
- Next.js App Router
- Supabase Auth with Next.js
- Supabase SSR/session handling
- Supabase PostgreSQL
- Supabase Row Level Security
- Vercel
- current recommended Next.js PWA approaches

Do not use deprecated patterns simply because you remember them.

Prefer established libraries for commodity functionality instead of unnecessarily rebuilding them.

Keep dependencies reasonably minimal.

==================================================
DATABASE
==================================================

Supabase PostgreSQL is the application's source of truth.

Design a simple maintainable schema appropriate for v1.

At minimum, the domain should represent:

1. application / organization attendance settings
2. authenticated users or app profiles if needed
3. immutable attendance events

Every attendance event must retain enough information to answer later:

"How was this action validated?"

An attendance event should include at least:

- authenticated Supabase user ID
- team member email snapshot
- event type
  - CLOCK_IN
  - CLOCK_OUT
- trusted server/database timestamp
- attendance day
- latitude used during validation
- longitude used during validation
- browser-reported GPS accuracy
- calculated distance from office
- geofence validation result
- source when useful
  - DIRECT
  - QR
- immutable created timestamp

Exact table/field names may differ if there is a better schema.

IMPORTANT:

Never trust the browser to provide the authoritative attendance timestamp.

Use server/database-generated timestamps.

Use database constraints, transactions and atomic operations wherever appropriate.

Prevent double-clicks, retries or concurrent requests from producing duplicate attendance records.

==================================================
ATTENDANCE RECORD IMMUTABILITY
==================================================

Attendance records are:

WRITE ONCE.
NEVER EDITED.

There is NO attendance-record editing in v1.

There is NO Admin correction feature in v1.

There is NO attendance deletion feature in v1.

Do not provide APIs or UI that modify historical attendance.

Enforce immutability beyond just hiding Edit/Delete buttons.

Prefer database-level and RLS-level protections wherever possible.

Attendance records are retained indefinitely for v1.

There is no retention/deletion workflow in v1.

Do not invent one.

==================================================
ATTENDANCE DAY
==================================================

A Team Member may have:

- maximum ONE Clock In per attendance day
- maximum ONE Clock Out per attendance day

Use one organization timezone for defining the attendance day.

Do not depend on the Vercel server's local timezone.

Keep the timezone server-controlled using something similar to:

ATTENDANCE_TIMEZONE

Use:

Asia/Manila

as the development/default configuration unless overridden during deployment.

Keep the timezone logic isolated so it can easily be changed later.

This timezone is NOT another Admin-editable setting in v1.

If someone forgot to Clock Out on a previous attendance day:

- do not automatically create a historical Clock Out
- do not modify the previous day's records
- do not block today's Clock In simply because yesterday was incomplete

Historical records remain immutable.

Document this behavior.

==================================================
AUTHORITATIVE NEXT-ACTION LOGIC
==================================================

The system must automatically determine whether the valid next attendance action is Clock In or Clock Out.

For the CURRENT attendance day:

STATE A

No Clock In exists.

Valid action:

CLOCK IN

STATE B

Clock In exists.
Clock Out does not exist.

Valid action:

CLOCK OUT

STATE C

Clock In exists.
Clock Out exists.

Attendance for the day is complete.

No additional attendance action is permitted.

The UI should only expose the valid action.

IMPORTANT:

The browser must NOT be authoritative for selecting the event type.

Do not design an API that simply trusts:

{
"type": "CLOCK_IN"
}

from the browser.

The server/database must inspect the current attendance state and determine the correct action itself.

The client may display:

Clock In

or:

Clock Out

but server-side logic remains authoritative.

Use database uniqueness and transactional logic so race conditions cannot produce:

- two Clock Ins
- two Clock Outs
- a Clock Out without a Clock In

==================================================
AUTHENTICATION
==================================================

There are exactly TWO roles:

1. Admin
2. Team Member

No Manager role.

No configurable roles.

No role-management UI.

---

## TEAM MEMBER AUTHENTICATION

Normal Team Members use:

Google OAuth / Google Workspace SSO

Only users from this domain are allowed:

@firstmate.tech

Examples:

ALLOWED:
jane@firstmate.tech

NOT ALLOWED:
jane@gmail.com
jane@anothercompany.com

The domain restriction must be enforced server-side.

Do not rely only on:

email.endsWith("@firstmate.tech")

inside browser JavaScript.

Research the current Supabase Google OAuth claims and recommended server-side validation method before implementing this.

A valid @firstmate.tech Google account becomes a Team Member automatically after its first valid authentication.

The allowed organization domain is NOT Admin-configurable.

---

## ADMIN AUTHENTICATION

For v1, the Admin account is:

admin@firstmate.tech

Admin should log in using:

email + password

through Supabase Auth.

DO NOT:

- hardcode the Admin password
- commit the Admin password
- put it in a client-visible environment variable
- create a publicly documented default password

Provide setup documentation explaining how to securely create:

admin@firstmate.tech

inside Supabase Auth.

The Admin authorization allow-list for v1 consists of:

admin@firstmate.tech

Admin status must be established server-side.

Do not allow a browser request to specify:

role: "admin"

and become an Admin.

Research current Supabase identity behavior before deciding whether the Admin account should ALSO be allowed to authenticate with Google.

Avoid accidentally creating two unrelated Supabase users/profiles using the same Admin email.

If there is ambiguity, prefer:

Admin -> email/password login
Team Member -> Google Workspace login

and document the decision.

---

## AUTHORIZATION

Authorization is NOT implemented by merely hiding navigation links.

Protect Admin functionality using server-side authorization and appropriate database/RLS policies.

A normal Team Member must not be able to modify Admin settings by manually calling an endpoint.

==================================================
ROLE CAPABILITIES
==================================================

TEAM MEMBER:

Allowed:

- authenticate with Google
- Clock In
- Clock Out
- see their current attendance state

Not allowed:

- modify office location
- modify geofence radius
- modify GPS accuracy threshold
- modify report link
- configure QR
- access Admin Settings
- view an Admin attendance dashboard
- edit historical attendance
- delete historical attendance
- manage roles

ADMIN:

Allowed:

- authenticate with admin email/password
- Clock In
- Clock Out
- configure office location
- configure geofence radius
- configure GPS accuracy threshold
- modify report link
- view/generate/print static attendance QR
- access Admin Settings

Not allowed:

- edit attendance history
- delete attendance history
- create arbitrary roles
- use an attendance-report dashboard because that is not part of v1

==================================================
GEOFENCING FLOW
==================================================

Expected flow:

1. User authenticates.
2. Application fetches today's authoritative attendance state.
3. Application displays only the valid action:
   - Clock In
   - Clock Out
   - Day Complete
4. User taps Clock In or Clock Out.
5. Browser requests the user's CURRENT location.
6. Client sends latitude, longitude and accuracy to trusted server-side logic.
7. Server verifies the attendance system is configured.
8. Server validates submitted coordinate values.
9. Server evaluates GPS accuracy.
10. Server calculates distance to office.
11. Server validates the geofence.
12. Server determines the authoritative attendance action.
13. Server atomically records the attendance event.
14. UI refreshes into the new state.

Location is checked ONCE for each attempted attendance action.

No continuous location monitoring.

No background location.

No periodic geolocation polling.

Do not use geolocation simply because the Attendance page is open.

==================================================
LOCATION VALIDATION
==================================================

The server must receive and validate:

- latitude
- longitude
- reported accuracy

The authoritative:

- office coordinates
- radius
- accuracy threshold

must come from server-controlled database configuration.

VALIDATION ORDER:

1. authenticate user
2. authorize request
3. confirm attendance/geofence is configured
4. validate latitude/longitude/accuracy inputs
5. reject the request if GPS accuracy is worse than the configured threshold
6. calculate distance from configured office
7. reject if outside the configured radius
8. determine the valid next attendance action
9. atomically record the event

Do not accept browser-generated values such as:

"isInsideGeofence": true

as authoritative.

The browser may display estimated distance for UX.

The server calculates the trusted validation result.

Use an appropriate geographical distance calculation.

A Haversine-style calculation or an appropriate Postgres/geospatial solution is acceptable.

Choose a sensible implementation and explain it.

Test boundary behavior.

==================================================
ANTI-SPOOFING
==================================================

Advanced location anti-spoofing is NOT required for v1.

Do not implement:

- device attestation
- IP geolocation comparison
- VPN detection
- GPS spoof detection
- Wi-Fi fingerprinting
- Bluetooth beacons

Browser Geolocation API plus server-side radius/accuracy validation is sufficient.

==================================================
GEOFENCE DEFAULTS
==================================================

Default geofence radius:

300 meters

Default GPS accuracy threshold:

50 meters

If the browser reports an accuracy worse than 50 meters:

reject the attendance attempt BEFORE performing the radius comparison.

The office coordinates initially start:

UNCONFIGURED

An Admin must configure the office location before attendance can be used.

There is exactly:

ONE OFFICE LOCATION

for the organization.

There is NO:

- multiple-office support
- per-user office
- branch support
- per-team location

==================================================
ADMIN SETTINGS
==================================================

The Admin Settings page contains FOUR primary settings.

---

1. OFFICE LOCATION

---

Store:

- latitude
- longitude

Admin configures the location using a map.

Admin should:

- place or drag a map pin
- visually see the selected office location
- save the selected position

Do NOT use raw coordinate text fields as the normal UX.

Coordinates may be shown as read-only technical information if useful, but map interaction is the primary configuration method.

---

2. GEOFENCE RADIUS

---

Unit:

meters

Default:

300 m

Applied to every Clock In and Clock Out.

---

3. ACCURACY THRESHOLD

---

Unit:

meters

Default:

50 m

If browser location accuracy is worse than the threshold:

reject the attendance attempt.

---

4. REPORT LINK

---

Admin-editable URL.

Initial value:

https://docs.google.com/spreadsheets/d/1aaFxa0_6wPRFo4h1p6BoYmnWQu1Ko6OB03XFdQqlWME/edit?usp=sharing

Validate the value as a URL.

Only Admin users should see/edit this setting.

==================================================
MAP PROVIDER
==================================================

A map provider has NOT been selected.

Research the current available options before implementation.

Requirements:

- works with Next.js
- works well on desktop and phones
- supports placing/dragging one pin
- production use allowed
- free or has an appropriate free tier for a small internal application
- minimal infrastructure
- straightforward deployment on Vercel

Evaluate suitable modern options.

Possible categories include:

- MapLibre-based approaches
- Leaflet-compatible approaches
- other current free/freemium map providers

Do not blindly use a public tile server whose production usage policy does not allow this application.

Document:

- provider chosen
- library chosen
- why it was selected
- any free-tier limitations
- any environment variables required

Do not build unnecessary mapping functionality.

This app only needs to configure one office location.

==================================================
QR CODE
==================================================

The QR code is a CONVENIENCE SHORTCUT.

It is NOT:

- an authentication factor
- proof of identity
- proof of location
- a geofence signal
- part of the security validation itself

There is ONE static QR code.

An Admin can:

- view it
- download/print through normal browser printing if appropriate
- place it physically in the office

Scanning it opens the Attendance application.

A sensible URL would be something similar to:

/attendance?source=qr

Exact routing may differ if there is a better design.

Expected QR flow:

Phone camera
-> scan QR
-> Attendance app opens

IF USER IS NOT AUTHENTICATED:

-> Google login
-> successful authentication
-> automatically return to Attendance page

IF USER IS AUTHENTICATED:

-> Attendance page opens directly

Then:

app checks today's state
-> displays Clock In OR Clock Out
-> user explicitly taps action
-> location is requested
-> server validates
-> event recorded

IMPORTANT:

Scanning the QR MUST NOT immediately Clock In or Clock Out.

The QR opens the application.

The application determines the valid action.

The user explicitly taps the action.

The normal geofence process still runs.

Preserve the QR source through authentication when reasonably useful.

==================================================
REPORTING / GOOGLE SHEETS
==================================================

IMPORTANT V1 SCOPE:

DO NOT IMPLEMENT Google Sheets synchronization.

Do NOT implement:

- Google Sheets API integration
- Apps Script integration
- automated Sheet writes
- background export
- CSV export
- in-app attendance reporting
- Admin attendance dashboard

Supabase PostgreSQL remains the authoritative attendance datastore.

For v1, Admin Settings simply contain the external Google Sheet report link:

https://docs.google.com/spreadsheets/d/1aaFxa0_6wPRFo4h1p6BoYmnWQu1Ko6OB03XFdQqlWME/edit?usp=sharing

The application may provide an:

Open Report

button.

That simply opens the configured external URL.

If useful, create:

docs/future-google-sheets-sync.md

describing a future one-way:

PostgreSQL -> Google Sheets

integration.

Do NOT implement it.

==================================================
PRIMARY MOBILE-FIRST REQUIREMENT
==================================================

THIS APPLICATION MUST BE DESIGNED MOBILE-FIRST.

This is not merely "responsive design".

The Team Member Attendance screen is primarily a PHONE PRODUCT.

The expected common workflow is:

scan QR using phone
-> PWA opens
-> sign in if required
-> Clock In / Clock Out
-> location verification
-> done

Do NOT design the Attendance screen for desktop first and then shrink it.

Build the mobile layout first.

Then progressively enhance for tablet/desktop.

==================================================
MOBILE ATTENDANCE SCREEN
==================================================

The Attendance screen should work comfortably on common phone sizes.

Requirements:

- primary action visible immediately
- minimal scrolling for the main attendance flow
- current attendance state clearly visible
- large Clock In / Clock Out button
- large comfortable touch targets
- generous separation between interactive controls
- readable text
- no tiny desktop controls
- no dense tables
- no hover-dependent interactions
- comfortable one-handed use
- mobile safe-area support
- no horizontal scrolling
- sensible use of dynamic viewport height
- work correctly in browser and installed-PWA mode

Prefer a simple vertical information hierarchy:

1. compact First Mate header / branding
2. current attendance/location state
3. time / elapsed information when relevant
4. primary Clock In / Clock Out action
5. supporting status/error information
6. secondary actions if needed

The Clock In / Clock Out action should visually dominate the page.

On a large desktop screen, the attendance content should remain focused and reasonably narrow rather than stretching across the screen.

==================================================
TOUCH TARGETS
==================================================

All interactive mobile controls must have comfortable touch areas.

Aim for at least approximately:

44x44 CSS pixels

for touch targets.

Primary Clock In / Clock Out buttons should be larger.

Avoid putting small controls immediately beside each other.

==================================================
MOBILE LOCATION UX
==================================================

Do NOT request location permission simply because the user visits the page.

The explicit attendance action triggers the request.

Example interaction:

User taps:

Clock In

UI becomes:

Checking your location...

Browser requests geolocation.

Then show one of the resulting states.

SUCCESS EXAMPLE:

You're at the office

Verified · 12m accuracy

Then record attendance.

OUTSIDE EXAMPLE:

Outside the office area

420m away · limit 300m

ACCURACY EXAMPLE:

A more accurate location is needed - try again outdoors

PERMISSION EXAMPLE:

Location access is required to clock in

Use Clock Out wording when appropriate.

==================================================
MOBILE QR -> AUTH EXPERIENCE
==================================================

The QR path must work smoothly on phones.

Do not introduce unnecessary intermediate pages.

Expected unauthenticated flow:

QR
-> Login
-> Continue with Google
-> Google OAuth
-> return directly to Attendance
-> valid attendance action visible

Do not make users manually navigate back after login.

Preserve the intended return destination through OAuth.

==================================================
MOBILE AUTHENTICATION UX
==================================================

Normal Team Member login should prioritize:

Continue with Google

Do not present normal Team Members with a cluttered login screen containing multiple equally prominent login methods.

Admin email/password login should be a separate or clearly secondary path.

For example:

Team Member:
Continue with Google

Secondary:
Admin login

Exact visual treatment may differ.

==================================================
MOBILE ADMIN FORMS
==================================================

Admin Settings must also remain usable on phones.

Requirements:

- fields stack vertically when needed
- labels remain visible
- appropriate HTML input types
- numeric keyboard for numeric fields when practical
- no horizontal overflow
- validation near the relevant field
- Save actions easy to reach
- adequate spacing
- avoid tiny controls

Desktop may provide a more spacious settings layout.

==================================================
MOBILE MAP UX
==================================================

Office-location configuration must remain usable on a phone.

The selected mapping library must support touch.

Ensure:

- map resizes correctly
- map does not overflow viewport
- pin can be placed/moved using touch
- Save action remains accessible
- gestures do not make the entire page unusable
- mobile scrolling behavior is reasonable

Desktop can show a larger map.

==================================================
PWA
==================================================

Make the application installable as a PWA.

Requirements:

- valid web app manifest
- app name
- short name
- icons
- theme/background metadata
- standalone-capable display mode
- correct mobile viewport handling
- usable when launched from the phone home screen
- HTTPS in production through Vercel

NO OFFLINE ATTENDANCE MODE IS REQUIRED.

Do NOT implement:

- offline Clock In
- offline Clock Out
- queued attendance mutations
- background sync of attendance
- local offline attendance records that later replay automatically

Attendance actions require an active network connection.

If offline:

"No connection - try again"

If a service worker is used:

do NOT cache/replay authenticated attendance mutations.

Static shell/assets may be cached if appropriate.

==================================================
PWA SAFE AREAS / MOBILE VIEWPORT
==================================================

Handle modern phone layouts correctly.

Consider:

- top safe area
- bottom safe area
- mobile browser chrome
- installed PWA standalone mode
- dynamic viewport height

Avoid blindly using layouts that depend entirely on:

100vh

when that creates phone-browser issues.

Primary bottom actions must not be hidden behind:

- browser controls
- home indicator areas
- safe-area insets

==================================================
ATTENDANCE UI STATES
==================================================

The primary Attendance experience should essentially be ONE focused screen whose content changes based on state.

---

## STATE 1 — READY TO CLOCK IN

Today's Clock In does not exist.

Show:

Clock In

as the dominant action.

When tapped:

request location
-> validate
-> create event

---

## STATE 2 — CHECKING LOCATION

Show a clear loading state.

Example:

Checking your location...

Prevent accidental repeated submissions while the attendance request is running.

---

## STATE 3 — OUTSIDE OFFICE

Example:

Outside the office area

480m away · limit 300m

No attendance record should be created.

Provide Retry when appropriate.

---

## STATE 4 — POOR GPS ACCURACY

Example:

A more accurate location is needed - try again outdoors

No attendance record should be created.

---

## STATE 5 — CURRENTLY CLOCKED IN

Show:

Clock In time

Example:

09:04

Elapsed time:

Elapsed 3h 12m

Prominent action:

Clock Out

Elapsed time may update in the UI, but that must not result in continuous location access.

---

## STATE 6 — DAY COMPLETE

Clock In and Clock Out both exist.

Show a clear completed state.

Example:

Attendance complete for today

Include useful summary information if appropriate, such as:

Clocked in
09:04

Clocked out
17:32

Do not show another Clock In button.

==================================================
EDGE CASES
==================================================

Every failure should have a clear plain-language explanation.

LOCATION PERMISSION DENIED / LOCATION SERVICES OFF:

"Location access is required to clock in"

Use appropriate Clock Out wording when needed.

CAN'T GET LOCATION:

Initially:

"Checking location..."

then provide Retry if the location request fails.

POOR ACCURACY:

"A more accurate location is needed - try again outdoors"

OUTSIDE GEOFENCE:

"You need to be within the office area to clock in"

Use Clock Out wording when applicable.

ATTENDANCE NOT CONFIGURED:

Disable attendance action.

Show:

"Attendance isn't set up yet"

ALREADY CLOCKED IN:

Do not display Clock In.

Display Clock Out.

ALREADY CLOCKED OUT:

Do not display Clock Out.

Display Day Complete.

NETWORK UNAVAILABLE:

"No connection - try again"

Do not queue the action for later.

==================================================
FIRST-RUN / UNCONFIGURED STATE
==================================================

The application initially has:

- 300 m radius default
- 50 m accuracy threshold default
- NO office coordinates configured

Admin should clearly see:

Attendance setup incomplete

or equivalent.

Admin must choose the office location on the map.

Until that happens, normal Team Members see:

"Attendance isn't set up yet"

and attendance actions remain disabled.

==================================================
UI / VISUAL DESIGN
==================================================

Visual reference:

https://www.firstmate.tech/

Before creating the design system:

1. Inspect the current First Mate website.
2. Study its broader visual language.
3. Identify reusable design characteristics.

Look at:

- primary colors
- secondary/accent colors
- background colors
- text colors
- typography
- font weights
- border radii
- borders
- card design
- shadows
- buttons
- whitespace
- spacing rhythm
- visual hierarchy
- interactive states
- general personality

Do not simply guess:

"First Mate uses blue."

Actually inspect the website.

We want the Attendance application to feel visually related to First Mate.

However:

Do NOT blindly copy the marketing site's page layouts.

Translate the brand language into a clean internal product interface.

The approved Attendance PDF mockups are primarily references for:

- product simplicity
- page states
- information hierarchy

The live First Mate website is the primary reference for:

- broader brand feel
- colors
- components
- visual language

Create reusable centralized design tokens rather than scattering arbitrary values throughout components.

If useful create:

docs/design-system.md

==================================================
SPACING
==================================================

Pay particular attention to proper spacing.

Use a consistent spacing scale.

Review:

- page margins
- content padding
- card padding
- section spacing
- button spacing
- form spacing
- heading spacing
- mobile edge spacing
- maximum content widths
- alignment
- mobile safe areas

Avoid random one-off spacing values when a design token can be used.

The interface should look intentionally designed rather than merely functional.

==================================================
ICONS
==================================================

Use icons wherever they meaningfully improve buttons/actions.

Examples:

- Continue with Google
- Clock In
- Clock Out
- Location
- Retry
- Settings
- Save
- QR Code
- Print
- Open Report
- Sign Out

Use ONE consistent icon library.

Do not mix several unrelated icon systems.

Icons should support text, not replace important labels.

Icon-only buttons require appropriate:

- accessible names
- aria labels
- tooltips where useful

==================================================
TRANSITIONS / MOTION
==================================================

Use subtle polished transitions.

---

## PAGE NAVIGATION

Use a fade-through transition.

Current page:

opacity 1 -> 0

duration:

approximately 200 ms

Then incoming page:

opacity 0 -> 1

duration:

approximately 200 ms

Keep it responsive.

Do not make navigation feel slow.

---

## COMPONENT TRANSITIONS

Use subtle transitions for:

- button background colors
- text colors
- hover states
- active/pressed states
- focus states
- cards
- status panels
- validation states
- loading -> success
- loading -> error

Do NOT over-animate.

---

## ACCESSIBILITY MOTION

Respect:

prefers-reduced-motion

Reduce or disable non-essential transitions when the user's system requests reduced motion.

==================================================
RESPONSIVE DESIGN
==================================================

Use responsive breakpoints intentionally.

Think approximately in terms of:

MOBILE
Primary attendance experience.

TABLET
Expanded attendance/settings experience.

DESKTOP
Expanded Admin/settings experience.

Do not create breakpoints merely because a CSS framework provides them.

Test real layouts.

==================================================
ACCESSIBILITY
==================================================

Build accessibly.

At minimum include:

- semantic HTML
- proper form labels
- semantic buttons
- visible keyboard focus
- keyboard navigation
- sufficient contrast
- screen-reader-accessible status messages
- accessible form errors
- meaningful loading states
- large enough touch targets
- reduced-motion support
- do not convey important state through color alone

Aim for practical WCAG AA behavior.

==================================================
PRIVACY
==================================================

Location is sensitive.

Follow these rules:

- request location only during explicit attendance actions
- no background tracking
- no continuous tracking
- no watchPosition loop
- no periodic location polling
- do not unnecessarily store location outside attendance events
- do not unnecessarily write precise coordinates into logs
- avoid sending location into analytics systems

The UI should make it understandable why location permission is being requested.

==================================================
SECURITY
==================================================

Treat authentication, geofence integrity and attendance writes as security-sensitive.

At minimum:

- use Supabase RLS appropriately
- enforce Admin authorization server-side
- enforce @firstmate.tech restriction server-side
- keep Supabase service-role credentials server-only
- never expose privileged keys in browser bundles
- validate all server input
- validate coordinates numerically
- validate GPS accuracy
- never trust browser role data
- never trust browser event type as authoritative
- never trust browser geofence results
- never trust browser timestamps for attendance
- use server/database-generated timestamps
- use database constraints
- use atomic attendance writes
- guard against retries/double submits
- prevent users modifying Admin settings
- protect attendance immutability

Perform a dedicated security review after implementation.

==================================================
APPLICATION STRUCTURE
==================================================

Keep the architecture modular but simple.

Likely domain areas:

- auth
- attendance
- geofence
- Admin settings
- QR
- PWA
- shared UI
- design system
- Supabase/database

Separate business rules from React presentation.

Attendance state logic and geofence validation should be testable without rendering UI.

Do not add unnecessary abstraction layers merely to make the project look "enterprise".

==================================================
EXPECTED ROUTES
==================================================

You may refine the routes after planning, but conceptually we need:

- Team Member Login
- Admin Login
- Attendance / Home
- OAuth callback
- Admin Settings
- Admin QR / print view

There is NO Admin attendance-report dashboard in v1.

Root routing should behave sensibly.

Examples:

Unauthenticated protected page:
-> Login

Team Member attempting /admin:
-> deny / redirect safely

QR visitor:
-> attendance destination preserved through authentication

==================================================
NO IN-APP REPORTING
==================================================

Do NOT create:

- attendance tables for Admin
- attendance analytics
- employee leaderboard
- weekly summaries
- payroll reports
- charts
- reporting dashboards

That is outside v1.

==================================================
OUT OF SCOPE
==================================================

DO NOT IMPLEMENT:

- continuous location tracking
- background location tracking
- multiple offices
- branches
- per-user office locations
- Manager role
- custom role management
- Admin attendance reporting dashboard
- attendance editing
- attendance corrections
- attendance overrides
- attendance deletion
- Google Sheets sync
- Apps Script integration
- automated reporting export
- CSV export
- offline Clock In
- offline Clock Out
- offline attendance queue
- advanced GPS spoof detection
- Wi-Fi verification
- Bluetooth beacons
- device attestation
- payroll
- schedules/shifts
- leave management
- employee HR profiles
- employee-management platform features

Stay disciplined about v1.

==================================================
TESTING
==================================================

Build a practical automated testing strategy.

Choose appropriate current tools.

At minimum test:

---

## ATTENDANCE STATE

- no Clock In -> Clock In is next action
- Clock In only -> Clock Out is next action
- Clock In + Clock Out -> Day Complete
- Clock Out cannot exist without Clock In
- duplicate Clock In prevented
- duplicate Clock Out prevented
- repeated request prevented
- concurrent requests do not create invalid duplicate records

---

## ATTENDANCE DAY

- attendance date calculated using configured organization timezone
- code does not accidentally use Vercel UTC as business date
- previous incomplete day does not prevent today's Clock In
- previous incomplete day is not automatically modified

---

## GEOFENCE

- accuracy worse than threshold rejected
- acceptable accuracy proceeds
- inside 300 m passes
- outside 300 m fails
- boundary behavior tested
- distance calculation tested
- geofence validation performed server-side

---

## AUTH

- valid @firstmate.tech Google user allowed
- outside-domain account denied
- Team Member cannot access Admin functionality
- Admin account receives Admin authorization
- browser cannot elevate itself to Admin
- unauthenticated API requests denied

---

## SETTINGS

- no office configured -> attendance unavailable
- Admin can set office location
- Team Member cannot set office location
- Admin can update radius
- Admin can update accuracy threshold
- Admin can update report link

---

## IMMUTABILITY

- attendance records cannot be updated through normal application access
- attendance records cannot be deleted through normal application access

---

## QR

- QR points to Attendance app
- unauthenticated QR user goes through login
- login returns user to Attendance
- QR does not bypass authentication
- QR does not bypass location validation
- QR does not directly Clock In/Out
- next action is still server-derived

---

## GEOLOCATION FAILURES

- permission denied
- location unavailable
- timeout/failure
- poor accuracy
- outside radius
- retry behavior

---

## NETWORK

- offline attendance shows failure
- no offline attendance queued
- failed network request does not produce a fake success state

==================================================
MOBILE TESTING — REQUIRED
==================================================

Mobile testing is NOT optional.

Verify at minimum:

- small phone viewport
- typical modern phone viewport
- larger phone viewport
- portrait orientation
- landscape orientation does not break layout
- installed-PWA-style viewport if tooling permits

Test the COMPLETE mobile journey:

QR URL
-> Login
-> Google authentication flow or test equivalent
-> Attendance screen
-> Clock In
-> Checking Location
-> successful geofence
-> Clocked In
-> Clock Out
-> Day Complete

Also verify mobile failure states:

- geolocation denied
- geolocation unavailable
- GPS accuracy > 50 m
- user outside 300 m
- network unavailable
- office location unconfigured

Inspect:

- touch target sizes
- button reachability
- readable text
- page padding
- safe-area handling
- no horizontal scroll
- no clipped content
- viewport-height behavior
- mobile keyboard behavior
- map behavior
- transition smoothness
- loading indicators
- browser back navigation
- OAuth return navigation

Use browser geolocation mocking where appropriate.

==================================================
VISUAL VERIFICATION
==================================================

Do NOT stop when:

npm run build

passes.

Actually start and inspect the application.

Verify:

- Team Member Login
- Admin Login
- mobile Attendance
- ready to Clock In
- Checking Location
- outside-geofence
- poor-accuracy
- Clocked In
- Clock Out
- Day Complete
- unconfigured attendance
- Admin Settings
- mobile Admin Settings
- desktop Admin Settings
- map pin interaction
- QR screen
- print layout
- phone layout
- desktop layout
- fade-through navigation
- component color transitions
- reduced-motion behavior
- PWA standalone layout if possible

Look specifically for:

- broken spacing
- overflow
- tiny touch controls
- inconsistent brand colors
- poor contrast
- layout shifts
- clipped bottom buttons
- PWA safe-area issues
- map interaction issues
- unnecessary scrolling
- desktop-only assumptions

Take screenshots when tooling permits and inspect them.

==================================================
CLAUDE CODE PROJECT CONFIGURATION
==================================================

Use Claude Code project configuration intentionally.

After the implementation plan is approved, create:

CLAUDE.md

Keep it concise.

CLAUDE.md should contain persistent high-value information such as:

- project purpose
- important commands
- architecture rules
- source-of-truth hierarchy
- critical product guardrails
- testing commands
- authentication rules
- security rules
- v1 scope exclusions

Do NOT dump the entire product specification into CLAUDE.md.

Keep detailed repeatable workflows/domain rules inside project Skills.

==================================================
CUSTOM CLAUDE CODE SKILLS
==================================================

Create project-local skills under:

.claude/skills/<skill-name>/SKILL.md

Create these skills when appropriate.

---

1. attendance-domain

---

Purpose:

Preserve authoritative attendance business rules.

Include:

- Clock In -> Clock Out state machine
- exactly one Clock In / Clock Out per attendance day
- attendance timezone behavior
- server-derived next action
- immutable attendance
- forgotten historical Clock Out behavior
- no corrections in v1

---

2. geofence-validation

---

Purpose:

Guide all location/geofence work.

Include:

- location requested only on attendance action
- accuracy checked before radius
- default radius 300 m
- default accuracy threshold 50 m
- server-side validation
- one office
- no continuous location
- no background tracking
- no advanced spoof detection

---

3. supabase-auth-security

---

Purpose:

Guide auth/security implementation.

Include:

- Team Member Google OAuth
- @firstmate.tech restriction
- admin@firstmate.tech Admin allow-list
- Admin email/password authentication
- RLS
- server authorization
- environment-secret handling
- never trust browser roles
- never trust browser attendance type

---

4. firstmate-design

---

Purpose:

Keep the UI visually consistent.

Include:

- First Mate website as visual reference
- brand/design token rules
- mobile-first Attendance
- icon consistency
- spacing scale
- 200 ms fade-through
- component transitions
- accessibility
- reduced-motion support
- mobile safe-area awareness

---

5. pwa-guardrails

---

Purpose:

Ensure PWA implementation does not accidentally create unsupported attendance behavior.

Include:

- manifest/installability
- icons
- standalone mode
- mobile viewport
- safe areas
- no offline attendance
- no mutation queue
- attendance remains server-required

---

6. admin-settings

---

Purpose:

Keep Admin functionality inside approved v1 scope.

Include:

- one office map pin
- radius default 300 m
- accuracy default 50 m
- editable report link
- QR print view
- no reports
- no attendance editing
- no role-management UI

---

7. verify-attendance

---

Purpose:

Repeatable end-to-end project verification.

Include:

- formatting
- lint
- typecheck
- unit tests
- database/integration tests
- production build
- application launch
- geolocation scenarios
- mobile viewport tests
- desktop tests
- QR flow
- authentication
- authorization
- PWA checks
- visual review

---

8. vercel-deployment

---

Purpose:

Production deployment checklist.

Include:

- environment variables
- Supabase production configuration
- Google OAuth callback URLs
- Vercel configuration
- HTTPS/geolocation requirements
- ATTENDANCE_TIMEZONE
- Admin account setup
- production office configuration
- production smoke test

==================================================
CLAUDE CODE BUILT-IN SKILLS / COMMANDS
==================================================

Before relying on built-in Claude Code skills/commands:

inspect the installed Claude Code version and list what is actually available.

Availability can vary.

Use useful built-in capabilities where available.

Potentially relevant capabilities include:

- Plan Mode
- /init
- /skills
- /reload-skills
- /run
- /run-skill-generator
- /verify
- /debug
- /simplify
- /code-review
- /security-review
- /doctor
- /diff
- /mcp
- /permissions
- /fewer-permission-prompts
- /design-sync

Do NOT use a capability simply because it exists.

Use it when it materially improves the implementation.

Particularly useful for this project:

PLAN MODE
Use before implementation.

RUN
Actually launch and interact with the application.

VERIFY
Verify the running application instead of assuming tests are enough.

DEBUG
Use when debugging auth, geolocation, PWA or runtime behavior.

SIMPLIFY
Run after the implementation is mostly complete to identify unnecessary complexity.

CODE REVIEW
Review correctness and maintainability.

SECURITY REVIEW
Review authentication, RLS, permissions and attendance integrity.

DOCTOR
Validate Claude/project configuration and development environment.

DESIGN-SYNC
Use only if useful for maintaining the application's design system.

==================================================
SUBAGENTS
==================================================

Use subagents where isolated review is genuinely valuable.

Good uses:

---

## SECURITY REVIEWER

Review:

- Supabase Auth
- Google domain enforcement
- Admin authorization
- RLS
- database functions
- server/client trust boundary
- immutable attendance
- environment variables
- leaked secrets
- privilege escalation

---

## UI / UX REVIEWER

Review:

- First Mate visual consistency
- mobile-first UX
- QR phone flow
- spacing
- touch targets
- responsive behavior
- PWA layout
- transitions
- accessibility

---

## QA REVIEWER

Review:

- attendance state machine
- attendance-day rules
- geofence boundary conditions
- concurrent writes
- error handling
- tests
- missing acceptance scenarios

Do not create unnecessary agents for straightforward implementation tasks.

==================================================
OPTIONAL MCP
==================================================

If relevant MCP integrations are already available and authenticated, you may use them.

Potentially useful:

- Supabase
- Vercel
- browser tools

Do NOT block development simply because an MCP is unavailable.

Do NOT perform irreversible changes to external production resources without explicit permission.

==================================================
IMPLEMENTATION PROCESS
==================================================

---

## PHASE 0 — RESEARCH

Before writing application code:

- inspect current official Next.js documentation
- inspect current Supabase Next.js/Auth guidance
- inspect Supabase RLS guidance
- inspect current PWA guidance
- inspect the current First Mate website
- research free/free-tier map providers
- determine current Vercel requirements
- determine OAuth redirect requirements

---

## PHASE 1 — PLAN

Present a practical implementation plan containing:

1. architecture
2. proposed supporting libraries
3. why each major library is chosen
4. database schema
5. database constraints
6. RLS strategy
7. attendance transaction design
8. attendance state machine
9. attendance-day/timezone approach
10. geofence calculation
11. Google auth flow
12. Admin auth flow
13. routing
14. UI/component structure
15. mobile-first approach
16. map provider choice
17. PWA implementation approach
18. design system approach
19. automated-testing approach
20. browser/mobile verification plan
21. custom Claude Skills
22. required environment variables
23. external manual setup steps
24. risks
25. assumptions

STOP after presenting the plan.

Wait for my approval before implementation.

---

## PHASE 2 — PROJECT BOOTSTRAP

After approval:

- initialize Next.js
- initialize Git if appropriate
- enable strict TypeScript
- configure linting/formatting
- create CLAUDE.md
- create project Skills
- create .env.example
- create testing setup
- establish Supabase migrations

---

## PHASE 3 — DATABASE / DOMAIN

Implement and test:

- database schema
- constraints
- RLS
- attendance immutability
- settings
- attendance state
- attendance transaction
- geofence calculation
- timezone behavior

Build/test domain functionality before investing heavily in UI.

---

## PHASE 4 — AUTH

Implement:

- Google OAuth
- @firstmate.tech restriction
- Admin email/password auth
- Admin allow-list
- protected routes
- authorization
- OAuth return destination

Test auth boundaries.

---

## PHASE 5 — MOBILE ATTENDANCE UI

Build MOBILE FIRST:

- Login
- Attendance state
- Clock In
- Checking Location
- Clocked In
- Clock Out
- Day Complete
- location errors
- network errors
- unconfigured state
- QR entry experience

Verify phone layouts before considering the attendance UI complete.

---

## PHASE 6 — ADMIN

Implement:

- Admin Settings
- office map
- radius
- accuracy threshold
- report link
- QR display
- print-friendly QR

Verify desktop AND phone layouts.

---

## PHASE 7 — DESIGN / PWA

Apply:

- First Mate design system
- icons
- spacing
- transitions
- accessibility
- mobile safe areas
- PWA configuration

---

## PHASE 8 — VERIFICATION

Run:

- formatter
- lint
- typecheck
- unit tests
- integration tests
- E2E tests
- production build

Then launch the actual application.

Visually inspect it.

Test mobile and desktop.

---

## PHASE 9 — REVIEWS

Perform:

- code review
- simplification review
- security review
- accessibility/UX review

Fix meaningful findings.

Re-run affected tests.

==================================================
DEFINITION OF DONE
==================================================

Do NOT declare the project complete until all applicable items below are true.

ARCHITECTURE

[ ] Next.js app runs successfully
[ ] TypeScript strictness configured
[ ] Supabase Postgres schema exists as migrations
[ ] configuration documented
[ ] environment example exists

AUTH

[ ] Team Member Google OAuth works
[ ] @firstmate.tech restriction is enforced server-side
[ ] outside-domain login is rejected
[ ] admin@firstmate.tech email/password login supported
[ ] Admin password is not committed
[ ] Admin authorization is server-controlled
[ ] Team Members cannot access Admin functionality
[ ] OAuth return path works correctly after QR entry

ATTENDANCE

[ ] next action is derived from server/database state
[ ] no Clock In -> Clock In
[ ] Clock In only -> Clock Out
[ ] Clock In + Clock Out -> Day Complete
[ ] one Clock In per attendance day enforced
[ ] one Clock Out per attendance day enforced
[ ] duplicate submissions prevented
[ ] concurrent requests protected
[ ] attendance timestamp is server/database controlled
[ ] attendance day respects configured timezone
[ ] yesterday's incomplete attendance does not get modified

GEOFENCE

[ ] office initially unconfigured
[ ] Admin can set office using map pin
[ ] exactly one office supported
[ ] default radius 300 m
[ ] default accuracy threshold 50 m
[ ] accuracy checked before radius
[ ] distance validation occurs server-side
[ ] browser cannot submit a fake geofence pass
[ ] no continuous location tracking
[ ] no background location tracking

IMMUTABILITY

[ ] attendance records cannot be edited
[ ] attendance records cannot be deleted through normal application access
[ ] no correction UI exists

QR

[ ] static QR exists
[ ] Admin can display/print QR
[ ] QR opens Attendance application
[ ] QR does not authenticate a user
[ ] QR does not validate location
[ ] QR does not automatically Clock In/Out
[ ] QR flow returns to Attendance after authentication

REPORTING

[ ] Admin report link exists
[ ] configured initial Google Sheet URL exists
[ ] Open Report functionality works
[ ] NO in-app attendance report exists
[ ] NO Google Sheets sync exists
[ ] NO Apps Script sync exists

PWA

[ ] PWA manifest valid
[ ] PWA icons configured
[ ] installable behavior verified where possible
[ ] standalone layout works
[ ] HTTPS-compatible
[ ] attendance requires network
[ ] no offline attendance queue exists
[ ] no attendance background-sync behavior exists

MOBILE

[ ] Attendance UI was designed mobile-first
[ ] full QR -> auth -> attendance flow tested on phone-sized viewport
[ ] primary Clock In/Out action immediately accessible
[ ] primary actions have comfortable touch targets
[ ] supporting touch targets are approximately 44x44 CSS px or larger
[ ] no horizontal overflow on supported phone sizes
[ ] text remains readable
[ ] safe areas handled
[ ] dynamic viewport behavior handled
[ ] installed-PWA viewport checked
[ ] location loading works on mobile
[ ] location errors work on mobile
[ ] map remains usable on mobile
[ ] Admin settings remain usable on mobile
[ ] portrait verified
[ ] landscape does not break layout

UI / DESIGN

[ ] design visually relates to current First Mate website
[ ] design tokens centralized
[ ] icon library consistent
[ ] buttons use icons where meaningful
[ ] spacing scale consistent
[ ] margins/padding reviewed
[ ] page fade-out approximately 200 ms
[ ] page fade-in approximately 200 ms
[ ] color/component transitions implemented
[ ] prefers-reduced-motion respected
[ ] accessible focus states exist
[ ] important state not communicated by color alone

TESTING

[ ] automated attendance-state tests pass
[ ] geofence tests pass
[ ] authentication tests pass
[ ] authorization tests pass
[ ] settings tests pass
[ ] immutability tests pass
[ ] QR tests pass
[ ] network/error tests pass
[ ] production build passes

VERIFICATION

[ ] actual application launched
[ ] mobile UI manually/browser verified
[ ] desktop UI verified
[ ] screenshots inspected where tooling permits
[ ] security review completed
[ ] code review completed
[ ] simplification review completed
[ ] README/setup documentation complete
[ ] Vercel deployment instructions complete

==================================================
FINAL DELIVERABLES
==================================================

When implementation is finished, provide:

1. concise architecture summary
2. project structure summary
3. database schema summary
4. RLS/security model
5. attendance state-machine explanation
6. attendance-day/timezone explanation
7. geofence implementation explanation
8. mobile-first UX summary
9. authentication setup instructions
10. Supabase setup instructions
11. Google OAuth setup instructions
12. Admin account setup instructions
13. environment-variable list
14. map-provider setup
15. PWA setup summary
16. Vercel deployment instructions
17. first-run Admin configuration steps
18. test commands
19. verification commands
20. known limitations
21. intentionally deferred v2 items
22. assumptions/decisions made during implementation

Also provide a manual setup checklist for anything requiring external credentials or dashboards that could not be completed automatically.

Do NOT claim an external service is configured unless you actually verified it.

==================================================
FINAL PRODUCT PRINCIPLE
==================================================

Build:

A SMALL,
SECURE,
FAST,
MOBILE-FIRST,
POLISHED

First Mate attendance application.

The Team Member experience should feel closer to using a simple mobile app than using an HR website.

Typical attendance should require only:

Scan QR
-> authenticate if needed
-> tap Clock In / Clock Out
-> allow location
-> done

Keep the workflow extremely simple.

Do not turn this into an HR platform.
