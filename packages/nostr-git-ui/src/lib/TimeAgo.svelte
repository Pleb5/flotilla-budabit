<script lang="ts">
  import { formatDistanceToNow } from "date-fns";
  const { date, addSuffix = true, compact = false } = $props<{
    date: string | number | Date;
    addSuffix?: boolean;
    compact?: boolean;
  }>();
  let formatted = $state("");

  const formatCompactDistance = (value: string | number | Date) => {
    const target = new Date(value).getTime();
    if (Number.isNaN(target)) return "";

    const diffMs = Date.now() - target;
    const future = diffMs < 0;
    const seconds = Math.max(0, Math.round(Math.abs(diffMs) / 1000));
    const units = [
      {limit: 60, seconds: 1, suffix: "s"},
      {limit: 60 * 60, seconds: 60, suffix: "m"},
      {limit: 60 * 60 * 24, seconds: 60 * 60, suffix: "h"},
      {limit: 60 * 60 * 24 * 30, seconds: 60 * 60 * 24, suffix: "d"},
      {limit: 60 * 60 * 24 * 365, seconds: 60 * 60 * 24 * 30, suffix: "mo"},
      {limit: Infinity, seconds: 60 * 60 * 24 * 365, suffix: "y"},
    ];
    const unit = units.find((candidate) => seconds < candidate.limit) || units[units.length - 1];
    const count = Math.max(1, Math.floor(seconds / unit.seconds));
    const distance = seconds < 5 ? "now" : `${count}${unit.suffix}`;

    if (!addSuffix || distance === "now") return distance;
    return future ? `in ${distance}` : `${distance} ago`;
  };

  $effect(() => {
    const currentDate = date;
    formatted = compact
      ? formatCompactDistance(currentDate)
      : formatDistanceToNow(new Date(currentDate), { addSuffix });
    const interval = setInterval(() => {
      formatted = compact
        ? formatCompactDistance(currentDate)
        : formatDistanceToNow(new Date(currentDate), { addSuffix });
    }, 60_000);
    return () => clearInterval(interval);
  });
</script>

<span>{formatted}</span>
