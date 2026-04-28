'use client';

import { use, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useChannelDetail } from '@/hooks/use-channel-detail';
import { ChannelHeader } from '@/components/analytics/channel/channel-header';
import { TabOverview } from '@/components/analytics/channel/tab-overview';
import { TabMonetization } from '@/components/analytics/channel/tab-monetization';
import { TabComparison } from '@/components/analytics/channel/tab-comparison';

type PageProps = { params: { id: string } };

export default function ChannelAnalyticsPage(props: PageProps) {
  // Next.js 14: params là object trực tiếp; truy cập qua React.use() cho forward-compat
  const params = (props.params && typeof (props.params as unknown as { then?: unknown }).then === 'function')
    ? (use(props.params as unknown as Promise<{ id: string }>))
    : props.params;
  const channelId = params.id;

  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const { data, isLoading, isError, error } = useChannelDetail(channelId, period);

  const isYouTube = data?.channel.platform === 'YOUTUBE';

  return (
    <div className="space-y-5">
      <ChannelHeader
        channel={data?.channel}
        isLoading={isLoading}
        period={period}
        onPeriodChange={setPeriod}
      />

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được chi tiết kênh</AlertTitle>
          <AlertDescription>{error?.message ?? 'Lỗi không xác định.'}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview" className="space-y-1">
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="monetization" disabled={isLoading || !isYouTube}>
            Monetization
            {!isLoading && !isYouTube && (
              <span className="ml-1 text-[10px] text-muted-foreground">(YT only)</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="comparison">So sánh</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <TabOverview
            data={data?.overview}
            channel={data?.channel}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="monetization">
          <TabMonetization
            data={data?.monetization}
            isLoading={isLoading}
            channelPlatform={data?.channel.platform}
          />
        </TabsContent>

        <TabsContent value="comparison">
          <TabComparison data={data?.comparison} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
