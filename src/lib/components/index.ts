// Git components
export { default as DiffViewer } from "./git/DiffViewer.svelte";
export { default as FileView } from "./git/FileView.svelte";
export { default as IssueCard } from "./git/IssueCard.svelte";
export { default as IssueThread } from "./git/IssueThread.svelte";
export { default as LiveSessionCard } from "./git/LiveSessionCard.svelte";
export { default as WikiSidebar } from "./git/WikiSidebar.svelte";
export { default as RepoTab } from "./git/RepoTab.svelte";
export { default as NewIssueForm } from "./git/NewIssueForm.svelte";
export { default as NewPRForm } from "./git/NewPRForm.svelte";
export { default as ConflictVisualizer } from "./git/ConflictVisualizer.svelte";
export { default as MergeStatus } from "./git/MergeStatus.svelte";
export { default as CommitCard } from "./git/CommitCard.svelte";
export { default as CommitHeader } from "./git/CommitHeader.svelte";
export { default as CommitSelector } from "./git/CommitSelector.svelte";
export { default as SplitDiff } from "./git/SplitDiff.svelte";
export { default as FileMetadataPanel } from "./git/FileMetadataPanel.svelte";
export { default as NewRepoWizard } from "./git/NewRepoWizard.svelte";
export { default as RepoDetailsStep } from "./git/RepoDetailsStep.svelte";
export { default as AdvancedSettingsStep } from "./git/AdvancedSettingsStep.svelte";
export { default as RepoProgressStep } from "./git/RepoProgressStep.svelte";
export { default as ProviderSelectionStep } from "./git/ProviderSelectionStep.svelte";
export { default as EditRepoPanel } from "./git/EditRepoPanel.svelte";
export { default as RepoPicker } from "./git/RepoPicker.svelte";
export { default as StackedDiff } from "./git/StackedDiff.svelte";
export { default as ForkRepoDialog } from "./git/ForkRepoDialog.svelte";
export { default as ImportRepoDialog } from "./git/ImportRepoDialog.svelte";
export { Repo } from "./git/Repo.svelte";
export { WorkerManager } from "./git/WorkerManager";
export {
  VendorReadRouter,
  type VendorReadRouterConfig,
  type VendorRef,
  type VendorFileInfo,
  type VendorDirectoryResult,
  type VendorFileContentResult,
  type VendorCommit,
  type VendorCommitResult,
} from "./git/VendorReadRouter";
export { default as BranchSelector } from "./git/BranchSelector.svelte";
export { default as RepoAlertBadge } from "./git/RepoAlertBadge.svelte";
export { default as MaintainerBadge } from "./git/MaintainerBadge.svelte";
export { default as StatusChip } from "./git/StatusChip.svelte";
export { default as Status } from "./git/Status.svelte";
export { default as RepoHeader } from "./git/RepoHeader.svelte";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
// Media viewers
export { default as ImageViewer } from "./git/viewers/ImageViewer.svelte";
export { default as PDFViewer } from "./git/viewers/PDFViewer.svelte";
export { default as VideoViewer } from "./git/viewers/VideoViewer.svelte";
export { default as AudioViewer } from "./git/viewers/AudioViewer.svelte";
export { default as BinaryViewer } from "./git/viewers/BinaryViewer.svelte";
// Thread components
export { default as ThreadCommit } from "./thread/ThreadCommit.svelte";
export { default as ThreadComposer } from "./thread/ThreadComposer.svelte";
export { default as ThreadMessage } from "./thread/ThreadMessage.svelte";
export { default as ContextMessages } from "./ContextMessages.svelte";
export { default as RichText } from "./RichText.svelte";
export { PermalinkExtension, type PermalinkExtensionOptions } from "./editor/PermalinkExtension";
export { default as Spinner } from "./editor/Spinner.svelte";
export { default as PeoplePicker } from "./people/PeoplePicker.svelte";

// UI primitives
export { Button } from "./ui/button";
export { Input } from "./ui/input";
export { Avatar, AvatarImage, AvatarFallback } from "./ui/avatar";
export { Textarea } from "./ui/textarea";
export * from "./ui/collapsible";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
export { Separator } from "./ui/separator";
export { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
export { Checkbox } from "./ui/checkbox";
export { Label } from "./ui/label";
export { Badge } from "./ui/badge";
export { ScrollArea } from "./ui/scroll-area";
export { Alert, AlertDescription, AlertTitle } from "./ui/alert";
export { Profile, ProfileLink } from "./ui/profile";
export { Progress } from "./ui/progress";
export { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

// Common actions
export { default as EventActions } from "./EventActions.svelte";
export { default as ReactionSummary } from "./ReactionSummary.svelte";
export { default as EventRenderer } from "./events/EventRenderer.svelte";

// User profile components
export { default as UserAvatar } from "./UserAvatar.svelte";
export { default as UserProfile } from "./UserProfile.svelte";

// Stores
export { toast } from "../stores/toast";
export { context } from "../stores/context";
export { tokens } from "../stores/tokens";
export { signer } from "../stores/signer";
// EventIO handles signing internally - no more signer exports needed

// Providers
export { default as ConfigProvider } from "../ConfigProvider.svelte";
export { default as FunctionProvider } from "../FunctionProvider.svelte";
