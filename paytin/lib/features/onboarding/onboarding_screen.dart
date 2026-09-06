import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../shell/app_shell.dart';
import 'widgets/onboarding_illustration.dart';

class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key});

  void _start(BuildContext context) {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(builder: (_) => const AppShell()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lime,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(child: OnboardingIllustration()),
              const SizedBox(height: 8),
              const _Headline(),
              const SizedBox(height: 14),
              const Text(
                'Spend, earn and track financial activity',
                style: TextStyle(
                  fontSize: 13.5,
                  color: Color(0xFF3C4A22),
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 22),
              Row(
                children: [
                  TextButton(
                    onPressed: () => _start(context),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.ink,
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(0, 44),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text(
                      'Skip',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                  ),
                  const Spacer(),
                  GestureDetector(
                    onTap: () => _start(context),
                    behavior: HitTestBehavior.opaque,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          "Let's Start",
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                            color: AppColors.ink,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Container(
                          width: 52,
                          height: 52,
                          decoration: const BoxDecoration(
                            color: AppColors.ink,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.arrow_outward,
                            color: Colors.white,
                            size: 22,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Headline extends StatelessWidget {
  const _Headline();

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(
      fontSize: 31,
      height: 1.15,
      fontWeight: FontWeight.w800,
      color: AppColors.ink,
      letterSpacing: -0.5,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Digital Banking', style: style),
        Row(
          children: [
            const Flexible(child: Text('Made ', style: style)),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.ink,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(
                Icons.arrow_forward,
                color: AppColors.lime,
                size: 20,
              ),
            ),
            const Text(' for', style: style),
          ],
        ),
        const Text('Digital Users', style: style),
      ],
    );
  }
}
