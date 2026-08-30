import 'package:intl/intl.dart';

/// Dates in Arabic, with the shapes the web app uses.
abstract final class Fmt {
  static final _day = DateFormat('d MMMM', 'ar');
  static final _dayTime = DateFormat('d MMMM · HH:mm', 'ar');
  static final _weekday = DateFormat('EEEE', 'ar');

  static String date(DateTime value) => _day.format(value);
  static String dateTime(DateTime value) => _dayTime.format(value);
  static String weekday(DateTime value) => _weekday.format(value);

  /// "منذ ٣ ساعات" and friends.
  ///
  /// Arabic does not just pluralise, it has a separate dual form and changes
  /// the noun again past ten. Handing back a number and a single word would
  /// produce "١ ساعات" — so each grammatical form is written out.
  static String ago(DateTime value) {
    final seconds = DateTime.now().difference(value).inSeconds;
    if (seconds < 60) return 'الآن';

    final minutes = seconds ~/ 60;
    if (minutes < 60) return 'منذ ${_count(minutes, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}';

    final hours = minutes ~/ 60;
    if (hours < 24) return 'منذ ${_count(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}';

    final days = hours ~/ 24;
    if (days < 30) return 'منذ ${_count(days, 'يوم', 'يومين', 'أيام', 'يوماً')}';

    return date(value);
  }

  /// Arabic counting: one, two, 3-10 (plural), 11+ (singular accusative).
  static String _count(int n, String one, String two, String few, String many) {
    if (n == 1) return one;
    if (n == 2) return two;
    if (n <= 10) return '$n $few';
    return '$n $many';
  }

  /// How a deadline should read on a card.
  static String due(DateTime value) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(value.year, value.month, value.day);
    final days = target.difference(today).inDays;

    if (days == 0) return 'اليوم';
    if (days == 1) return 'غداً';
    if (days == -1) return 'أمس';
    if (days < 0) return 'متأخرة ${_count(-days, 'يوماً', 'يومين', 'أيام', 'يوماً')}';
    if (days < 7) return weekday(value);
    return date(value);
  }
}
