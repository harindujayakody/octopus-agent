/// Shared UI — thin FSD facade over the Shardx UI Kit plus app-specific
/// wrappers. Import UI primitives from here, not from the kit directly.
export {
  Button,
  Tag,
  Alert,
  Input,
  Textarea,
  Checkbox,
  Radio,
  Switch,
  Select,
  Slider,
  Tabs,
  SegmentControl,
  ProgressBar,
  Tooltip,
  Modal,
  AlertModal,
  DialogModal,
  Pagination,
  cn,
} from "@proxyshard/shardx-ui-kit";
export type {
  ButtonProps,
  SelectOption,
  SegmentItem,
  TabItem,
} from "@proxyshard/shardx-ui-kit";

export { Badge } from "@proxyshard/shardx-ui-kit";
export type { BadgeProps, BadgeColor, BadgeVariant, BadgeSize } from "@proxyshard/shardx-ui-kit";

export { Field } from "./Field";
export { NumField } from "./NumField";
export { SelectField } from "./SelectField";
export { Pair } from "./Pair";
export { PortList } from "./PortList";
export { CopyField } from "./CopyField";
export { CountryFlag } from "./CountryFlag";
export { ProxyFlag } from "./ProxyFlag";
export { RowHoverActions } from "./RowHoverActions";
