/// Formats a number as US-style currency, e.g. `25453` -> `$25,453.00`.
/// Negative values render as `-$290.00`; pass [withSign] for a leading `+`.
String money(num value, {bool withSign = false}) {
  final isNegative = value < 0;
  final fixed = value.abs().toStringAsFixed(2);
  final parts = fixed.split('.');
  final intPart = parts[0];

  final buffer = StringBuffer();
  for (var i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 == 0) buffer.write(',');
    buffer.write(intPart[i]);
  }

  final core = '\$$buffer.${parts[1]}';
  if (isNegative) return '-$core';
  if (withSign) return '+$core';
  return core;
}
