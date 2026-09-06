# Paytin — Flutter finance app

A cross‑platform (Android + iOS) Flutter UI built from the **Paytin** design:
an onboarding screen, a home dashboard (balance card, quick actions, quick send,
recent activity) and a statistics screen (period selector, earning / spending
cards, segmented‑bar overview chart) tied together by a floating pill navigation
bar with a raised centre scan button.

The UI is 100% Flutter — no image assets, no third‑party packages. Charts, the
onboarding illustration and the radar mark are drawn with `CustomPainter`.

## Requirements

- Flutter SDK **3.19+** (Dart 3.3+). Check with `flutter --version`.
- Android: Android Studio + an emulator or a device with USB debugging.
- iOS: a Mac with Xcode + CocoaPods (`sudo gem install cocoapods`).

## First run

This repo holds the Dart source, `pubspec.yaml` and tests. Generate the native
Android/iOS project folders once, from inside `paytin/`:

```bash
flutter create . --project-name paytin --org com.paytin --platforms=android,ios
flutter pub get
```

`flutter create .` only adds the missing `android/`, `ios/`, `.metadata` etc.
It does **not** touch `lib/`, `test/` or `pubspec.yaml`.

## Run

```bash
flutter devices          # list connected devices / emulators
flutter run              # debug run on the selected device
flutter run --release    # release build
```

Build installable artifacts:

```bash
flutter build apk            # Android APK
flutter build appbundle      # Android App Bundle (Play Store)
flutter build ios            # iOS (then archive in Xcode for the App Store)
```

## Test & analyse

```bash
flutter test
flutter analyze
```

## Project layout

```
lib/
  main.dart                     app entry
  app.dart                      MaterialApp + theme wiring
  core/
    app_colors.dart             palette sampled from the design
    app_theme.dart              ThemeData
    format.dart                 currency formatting
  models/                       Contact, ActivityItem, MonthSpending
  data/demo_data.dart           static sample content
  widgets/                      SectionHeader, DashedLine, PeriodTabBar
  features/
    onboarding/                 onboarding screen + canvas illustration
    shell/app_shell.dart        IndexedStack + floating pill nav
    home/                       home screen + balance card, quick actions,
                                quick send, recent activity
    statistics/                 statistics screen + earning card, spending
                                card, spending radar, overview chart
```

## Notes

- All figures (balance, transactions, chart data) are hard‑coded in
  `lib/data/demo_data.dart` — swap that for a repository/API layer to make it live.
- The centre scan button shows a placeholder snackbar; wire it to a scanner
  package (e.g. `mobile_scanner`) when needed.
