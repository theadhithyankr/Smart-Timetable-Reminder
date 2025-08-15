# Development Setup

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v16.17.4 or higher)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [EAS CLI](https://docs.expo.dev/build/setup/) for building

## Local Development

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Development Server**
   ```bash
   npx expo start
   ```

3. **Run on Device/Emulator**
   - Scan QR code with Expo Go app (iOS/Android)
   - Press `a` for Android emulator
   - Press `i` for iOS simulator

## Project Structure

```
timetable-reminder/
├── App.js                 # Main application component
├── app.json              # Expo configuration
├── eas.json              # EAS Build configuration
├── package.json          # Dependencies and scripts
├── assets/               # App icons and splash screens
│   ├── icon.png
│   ├── splash-icon.png
│   └── ...
└── docs/                 # Documentation
    └── DEVELOPMENT.md
```

## Key Components

### App.js
The main application file containing:
- State management for timetable entries
- Notification scheduling logic
- UI components and navigation
- Theme configuration

### Configuration Files
- **app.json**: Expo app metadata, permissions, and build settings
- **eas.json**: Build profiles for different environments
- **package.json**: Dependencies and npm scripts

## Debugging

### Enable Debug Mode
```bash
npx expo start --dev-client
```

### View Logs
- Use Expo Dev Tools in browser
- Check React Native debugger
- View device logs with `adb logcat` (Android)

## Building

### Development Build
```bash
eas build --profile development --platform android
```

### Production Build
```bash
eas build --profile production --platform android
```

### Local Build (macOS/Linux only)
```bash
eas build --local --platform android
```

## Troubleshooting

### Common Issues

1. **Metro bundler issues**
   ```bash
   npx expo start --clear
   ```

2. **Node modules conflicts**
   ```bash
   rm -rf node_modules
   npm install
   ```

3. **EAS Build failures**
   - Check eas.json configuration
   - Verify app.json settings
   - Review build logs

### Notification Testing

1. Use physical device (notifications don't work in simulator)
2. Enable notification permissions
3. Test with different lead times
4. Verify time zone handling

## Code Style

- Use ES6+ features
- Follow React Native best practices
- Maintain consistent indentation (2 spaces)
- Use meaningful variable names
- Comment complex logic

## Git Workflow

1. Create feature branch from main
2. Make changes and test thoroughly
3. Commit with descriptive messages
4. Push to remote repository
5. Create pull request
