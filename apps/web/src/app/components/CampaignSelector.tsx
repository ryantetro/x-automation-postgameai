import Link from "next/link";
import type { CampaignConfig } from "../lib/data";

interface CampaignSelectorProps {
  campaigns: CampaignConfig[];
  activeCampaign: string | null;
  currentPath: string;
}

export default function CampaignSelector({ campaigns, activeCampaign, currentPath }: CampaignSelectorProps) {
  if (campaigns.length === 0) return null;

  return (
    <div className="campaign-selector">
      <div className="campaign-selector-label">Campaigns</div>
      <Link
        href={currentPath}
        className={`campaign-pill${!activeCampaign ? " active" : ""}`}
      >
        All Campaigns
      </Link>
      {campaigns.map((c) => (
        <Link
          key={c.slug}
          href={`${currentPath}?campaign=${c.slug}`}
          className={`campaign-pill${activeCampaign === c.slug ? " active" : ""}`}
        >
          {c.name}
        </Link>
      ))}
    </div>
  );
}
