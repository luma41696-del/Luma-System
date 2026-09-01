import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../core/app_colors.dart';
import '../core/app_theme.dart';

/// Images the way this system actually stores them.
///
/// Two kinds arrive: a Firebase Storage download link, and a `data:` URL —
/// the web uploader inlines anything small rather than paying for a round
/// trip. `Image.network` silently fails on the second kind, which is why
/// pictures that existed were never appearing.
ImageProvider? imageProviderFor(String? url) {
  if (url == null || url.isEmpty) return null;

  if (url.startsWith('data:')) {
    final comma = url.indexOf(',');
    if (comma == -1) return null;
    try {
      return MemoryImage(
        Uint8List.fromList(base64Decode(url.substring(comma + 1))),
      );
    } on Object {
      return null;
    }
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return NetworkImage(url);
  }
  return null;
}

/// One image, with something sensible on screen while it loads and when it
/// fails — a bare `Image.network` shows an exception box to the user.
class LumaImage extends StatelessWidget {
  const LumaImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.radius = 14,
  });

  final String? url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final provider = imageProviderFor(url);
    if (provider == null) return _Fallback(width: width, height: height, radius: radius);

    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Image(
        image: provider,
        width: width,
        height: height,
        fit: fit,
        loadingBuilder: (context, child, progress) {
          if (progress == null) return child;
          return Container(
            width: width,
            height: height ?? 180,
            color: AppColors.bgSurface2,
            alignment: Alignment.center,
            child: SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppColors.brandLight,
                value: progress.expectedTotalBytes == null
                    ? null
                    : progress.cumulativeBytesLoaded /
                        progress.expectedTotalBytes!,
              ),
            ),
          );
        },
        errorBuilder: (context, _, _) =>
            _Fallback(width: width, height: height, radius: radius),
      ),
    );
  }
}

class _Fallback extends StatelessWidget {
  const _Fallback({this.width, this.height, this.radius = 14});

  final double? width;
  final double? height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height ?? 140,
      decoration: BoxDecoration(
        color: AppColors.bgSurface2,
        borderRadius: BorderRadius.circular(radius),
      ),
      alignment: Alignment.center,
      child: Icon(
        Icons.image_not_supported_outlined,
        color: AppColors.textMuted,
        size: 26,
      ),
    );
  }
}

/// Full screen, pinch to zoom, tap to dismiss.
void openImageViewer(BuildContext context, String url, {String? name}) {
  final provider = imageProviderFor(url);
  if (provider == null) return;

  Navigator.of(context).push(
    PageRouteBuilder<void>(
      opaque: false,
      barrierColor: Colors.black87,
      transitionDuration: const Duration(milliseconds: 240),
      pageBuilder: (context, animation, _) => FadeTransition(
        opacity: animation,
        child: _Viewer(provider: provider, url: url, name: name),
      ),
    ),
  );
}

class _Viewer extends StatelessWidget {
  const _Viewer({required this.provider, required this.url, this.name});

  final ImageProvider provider;
  final String url;
  final String? name;

  @override
  Widget build(BuildContext context) {
    final label = name;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GestureDetector(
        onTap: () => Navigator.of(context).pop(),
        child: Stack(
          children: [
            Center(
              child: Hero(
                tag: url,
                child: InteractiveViewer(
                  minScale: 1,
                  maxScale: 5,
                  child: Image(image: provider, fit: BoxFit.contain),
                ),
              ),
            ),
            SafeArea(
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                    color: Colors.white,
                    tooltip: 'إغلاق',
                  ),
                  if (label != null)
                    Expanded(
                      child: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.white70),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A file that is not an image — shown as a row rather than a broken preview.
class FileChip extends StatelessWidget {
  const FileChip({super.key, required this.name, this.size});

  final String name;
  final num? size;

  @override
  Widget build(BuildContext context) {
    final bytes = size;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.bgSurface2,
        borderRadius: BorderRadius.circular(AppRadius.tile),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.attach_file_rounded, size: 17, color: AppColors.textMuted),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13),
            ),
          ),
          if (bytes != null) ...[
            const SizedBox(width: 8),
            Text(
              formatBytes(bytes),
              style: TextStyle(fontSize: 11, color: AppColors.textMuted),
            ),
          ],
        ],
      ),
    );
  }

  static String formatBytes(num bytes) {
    if (bytes < 1024) return '$bytes بايت';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} كيلوبايت';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} ميغابايت';
  }
}
