import {
  RiHome5Line,
  RiSearchLine,
  RiUser3Line,
  RiSettings3Line,
  RiNotification3Line,
  RiHeartLine,
  RiStarLine,
  RiShieldCheckLine,
  RiGlobalLine,
  RiDownloadLine,
  RiUploadLine,
  RiDeleteBinLine,
  RiEditLine,
  RiCheckLine,
  RiCloseLine,
  RiArrowRightSLine,
  RiEyeLine,
  RiLockLine,
  RiMailLine,
  RiTimeLine,
  RiFlashlightFill,
  RiRocketFill,
  RiFireFill,
  RiThumbUpFill,
} from '@/icons'
import Section from './Section'

const icons = [
  RiHome5Line, RiSearchLine, RiUser3Line, RiSettings3Line,
  RiNotification3Line, RiHeartLine, RiStarLine, RiShieldCheckLine,
  RiGlobalLine, RiDownloadLine, RiUploadLine, RiDeleteBinLine,
  RiEditLine, RiCheckLine, RiCloseLine, RiArrowRightSLine,
  RiEyeLine, RiLockLine, RiMailLine, RiTimeLine,
]

export default function IconsShowcase() {
  return (
    <Section
      title="Icons"
      description="3,229 Remix icons imported as components via SVGR. They use currentColor, so they follow the theme and any text-* colour."
    >
      {/* Neutral grid — inherits text colour → adapts to theme */}
      <div className="flex flex-wrap gap-2 text-text-sub-600">
        {icons.map((Icon, i) => (
          <div
            key={i}
            className="flex size-10 items-center justify-center rounded-control bg-bg-weak-50 ring-1 ring-inset ring-stroke-soft-200"
          >
            <Icon className="size-5" />
          </div>
        ))}
      </div>

      {/* Colour follows text-* utility */}
      <div className="flex flex-wrap items-center gap-4">
        <RiFlashlightFill className="size-6 text-primary-base" />
        <RiRocketFill className="size-6 text-information-base" />
        <RiFireFill className="size-6 text-error-base" />
        <RiThumbUpFill className="size-6 text-success-base" />
        <RiStarLine className="size-6 text-warning-base" />
        <span className="text-body text-text-sub-600">
          — same components, colour driven by <code>text-*</code>
        </span>
      </div>
    </Section>
  )
}
