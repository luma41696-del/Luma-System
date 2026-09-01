import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/app_colors.dart';
import '../../data/api.dart';
import '../../data/pairing_payload.dart';

/// Points the camera at the code the browser is showing.
///
/// The exchange is: scan -> ask that server to redeem the code -> receive a
/// custom token -> sign in with it. The account is never named by the phone;
/// it comes from the browser session that drew the code.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [BarcodeFormat.qrCode],
  );

  /// The camera keeps firing while a redeem is in flight; without this, one
  /// code would be sent several times and every attempt after the first would
  /// fail as "already used".
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_busy) return;

    for (final barcode in capture.barcodes) {
      final payload = PairingPayload.tryParse(barcode.rawValue ?? '');
      if (payload == null) continue;

      setState(() {
        _busy = true;
        _error = null;
      });
      await _redeem(payload);
      return;
    }
  }

  Future<void> _redeem(PairingPayload payload) async {
    try {
      final result = await LumaApi.instance.call(
        'redeemPairing',
        payload: payload.redeemRequest(_deviceLabel()),
        overrideBase: payload.apiBase,
      );

      final token = result['token'];
      if (token is! String || token.isEmpty) {
        throw const ApiException('internal', 'لم يصل رمز الدخول من الخادم.');
      }

      // Only remembered once the server has proved itself by returning a token
      // this project actually accepts.
      await FirebaseAuth.instance.signInWithCustomToken(token);
      await LumaApi.instance.setBase(payload.apiBase);

      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (error) {
      _fail(error.message);
    } on FirebaseAuthException {
      _fail('رمز الدخول غير مقبول. تأكد أنك تمسح رمز نظام لوما.');
    } on Object {
      _fail('تعذّر إكمال الربط. حاول مرة أخرى.');
    }
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = message;
    });
  }

  static String _deviceLabel() =>
      Platform.isIOS ? 'iPhone' : (Platform.isAndroid ? 'Android' : 'هاتف');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgApp,
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          const _ViewfinderScrim(),
          SafeArea(
            child: Column(
              children: [
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.arrow_forward_rounded),
                      color: Colors.white,
                      tooltip: 'رجوع',
                    ),
                  ),
                ),
                const Spacer(),
                Padding(
                  padding: const EdgeInsets.fromLTRB(28, 0, 28, 36),
                  child: _Status(busy: _busy, error: _error),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.busy, required this.error});

  final bool busy;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final message = error;

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 250),
      child: switch ((busy, message)) {
        (true, _) => Column(
            key: ValueKey('busy'),
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 26,
                height: 26,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: AppColors.brand,
                ),
              ),
              SizedBox(height: 14),
              Text(
                'جارٍ الربط…',
                style: TextStyle(color: Colors.white, fontSize: 15),
              ),
            ],
          ),
        (false, final String text) => Container(
            key: const ValueKey('error'),
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            decoration: BoxDecoration(
              color: AppColors.danger,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              children: [
                const Icon(Icons.error_outline_rounded, color: Colors.white),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    text,
                    style: const TextStyle(color: Colors.white, height: 1.45),
                  ),
                ),
              ],
            ),
          ),
        _ => const Text(
            key: ValueKey('idle'),
            'وجّه الكاميرا إلى الرمز الظاهر على شاشة الموقع',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white70, fontSize: 15, height: 1.5),
          ),
      },
    );
  }
}

/// Darkens everything except the square in the middle, so it is obvious where
/// the code belongs.
class _ViewfinderScrim extends StatelessWidget {
  const _ViewfinderScrim();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final side = constraints.biggest.shortestSide * .68;
        return Stack(
          alignment: Alignment.center,
          children: [
            ColorFiltered(
              colorFilter: ColorFilter.mode(
                Colors.black.withValues(alpha: .62),
                BlendMode.srcOut,
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    decoration: const BoxDecoration(
                      color: Colors.black,
                      backgroundBlendMode: BlendMode.dstOut,
                    ),
                  ),
                  Container(
                    width: side,
                    height: side,
                    decoration: BoxDecoration(
                      color: Colors.black,
                      borderRadius: BorderRadius.circular(28),
                    ),
                  ),
                ],
              ),
            ),
            Container(
              width: side,
              height: side,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.brand, width: 3),
                borderRadius: BorderRadius.circular(28),
              ),
            ),
          ],
        );
      },
    );
  }
}
