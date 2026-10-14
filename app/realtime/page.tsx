import { LiveLogicDirectionBoard } from '@/components/features/LiveLogicDirectionBoard';
import { RealtimeRankingBoard } from '@/components/features/RealtimeRankingBoard';

export default function RealtimePage() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      <LiveLogicDirectionBoard />
      <div className="min-h-0 min-w-0 flex-1">
        <RealtimeRankingBoard />
      </div>
    </div>
  );
}
