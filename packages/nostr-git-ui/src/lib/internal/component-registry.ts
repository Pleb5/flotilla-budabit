export const REGISTRY = Symbol("ui-component-registry");

export type Registry = {
  Alert: typeof import("../components/ui/alert/alert.svelte").default;
  AlertDescription: typeof import("../components/ui/alert/alert-description.svelte").default;
  AlertTitle: typeof import("../components/ui/alert/alert-title.svelte").default;
  Avatar: typeof import("../components/ui/avatar/avatar.svelte").default;
  AvatarFallback: typeof import("../components/ui/avatar/avatar-fallback.svelte").default;
  AvatarImage: typeof import("../components/ui/avatar/avatar-image.svelte").default;
  Badge: typeof import("../components/ui/badge/badge.svelte").default;
  Button: typeof import("../components/ui/button/button.svelte").default;
  Card: typeof import("../components/ui/card/card.svelte").default;
  CardContent: typeof import("../components/ui/card/card-content.svelte").default;
  CardHeader: typeof import("../components/ui/card/card-header.svelte").default;
  CardTitle: typeof import("../components/ui/card/card-title.svelte").default;
  Checkbox: typeof import("../components/ui/checkbox/checkbox.svelte").default;
  Collapsible: typeof import("../components/ui/collapsible");
  Input: typeof import("../components/ui/input/input.svelte").default;
  Label: typeof import("../components/ui/label/label.svelte").default;
  ProfileComponent: typeof import("../components/ui/profile/profile.svelte").default;
  ProfileLink: typeof import("../components/ui/profile/profile-link.svelte").default;
  Progress: typeof import("../components/ui/progress/progress.svelte").default;
  ScrollArea: typeof import("../components/ui/scroll-area/scroll-area.svelte").default;
  Separator: typeof import("../components/ui/separator/separator.svelte").default;
  Tabs: typeof import("../components/ui/tabs/tabs-list.svelte").default;
  TabsContent: typeof import("../components/ui/tabs/tabs-content.svelte").default;
  TabsList: typeof import("../components/ui/tabs/tabs-list.svelte").default;
  TabsTrigger: typeof import("../components/ui/tabs/tabs-trigger.svelte").default;
  Textarea: typeof import("../components/ui/textarea/textarea.svelte").default;
  EventActions: typeof import("../components/EventActions.svelte").default;
  ReactionSummary: typeof import("../components/ReactionSummary.svelte").default;
  Spinner: typeof import("../components/editor/Spinner.svelte").default;
  CommentStatus?: any; // Optional component provided by consuming app
  Markdown?: any; // Optional component provided by consuming app
};

import Alert from "../components/ui/alert/alert.svelte";
import AlertDescription from "../components/ui/alert/alert-description.svelte";
import AlertTitle from "../components/ui/alert/alert-title.svelte";
import Avatar from "../components/ui/avatar/avatar.svelte";
import AvatarFallback from "../components/ui/avatar/avatar-fallback.svelte";
import AvatarImage from "../components/ui/avatar/avatar-image.svelte";
import Badge from "../components/ui/badge/badge.svelte";
import Button from "../components/ui/button/button.svelte";
import Card from "../components/ui/card/card.svelte";
import CardContent from "../components/ui/card/card-content.svelte";
import CardHeader from "../components/ui/card/card-header.svelte";
import CardTitle from "../components/ui/card/card-title.svelte";
import Checkbox from "../components/ui/checkbox/checkbox.svelte";
import * as Collapsible from "../components/ui/collapsible";
import Input from "../components/ui/input/input.svelte";
import Label from "../components/ui/label/label.svelte";
import ProfileComponent from "../components/ui/profile/profile.svelte";
import ProfileLink from "../components/ui/profile/profile-link.svelte";
import Progress from "../components/ui/progress/progress.svelte";
import ScrollArea from "../components/ui/scroll-area/scroll-area.svelte";
import Separator from "../components/ui/separator/separator.svelte";
import Tabs from "../components/ui/tabs/tabs-list.svelte";
import TabsContent from "../components/ui/tabs/tabs-content.svelte";
import TabsList from "../components/ui/tabs/tabs-list.svelte";
import TabsTrigger from "../components/ui/tabs/tabs-trigger.svelte";
import Textarea from "../components/ui/textarea/textarea.svelte";
import EventActions from "../components/EventActions.svelte";
import ReactionSummary from "../components/ReactionSummary.svelte";
import Spinner from "../components/editor/Spinner.svelte";

export const defaultRegistry: Registry = {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Collapsible,
  Input,
  Label,
  ProfileComponent,
  ProfileLink,
  Progress,
  ScrollArea,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  EventActions,
  ReactionSummary,
  Spinner,
  CommentStatus: undefined,
  Markdown: undefined,
};
