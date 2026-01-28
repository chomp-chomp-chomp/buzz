# Chomp Buzz

Chomp Buzz is a private, one-to-one mobile web app for sending a simple “buzz” between two people.

Each person installs the app to their iPhone home screen. Pressing a single button sends a quiet push notification to the other person. There is no chat, no feed, and no obligation to respond.

The app is intentionally minimal and designed for presence without conversation.

---

## Key characteristics

- **Private pairing**  
  Chomp Buzz connects exactly two people using a short pairing code.

- **One-button interaction**  
  A single button sends a buzz. No messages, replies, or read receipts.

- **Push notifications**  
  Buzzes are delivered via push notification when the app is installed to the home screen.

- **Built-in restraint**  
  A fixed cooldown between buzzes prevents spam and preserves meaning.

- **Two modes**  
  - *Calm*: neutral, understated notification tone  
  - *Chomp*: warmer, playful tone  

---

## Platform

- iOS (via homescreen-installed Progressive Web App)
- No App Store listing required

Push notifications require:
- iOS 16.4+
- Installation via “Add to Home Screen”

---

## Design philosophy

Chomp Buzz intentionally avoids:
- messaging threads
- engagement metrics
- analytics and tracking
- social graphs

It is designed as a small, deliberate signal rather than a communication platform.

Additional documentation is available within the app itself.

---

## Status

This project is complete by design.

---

## Notifications manual checklist

- iOS installed: default → enable → subscribed → test push works
- denied → help panel shown
- granted but no subscription → fix → subscribed
- subscription expired → fix → resubscribed
