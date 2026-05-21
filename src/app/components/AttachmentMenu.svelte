<script lang="ts">
  import GallerySend from "@assets/icons/gallery-send.svg?dataurl"
  import File from "@assets/icons/file.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"

  type Props = {
    onPickFile: () => void
    onPickMedia: () => void
    onClick?: () => void
  }

  const {onPickFile, onPickMedia, onClick}: Props = $props()

  const pickMedia = () => {
    onPickMedia()
    onClick?.()
  }

  const pickFile = () => {
    onPickFile()
    onClick?.()
  }
</script>

<ul class="menu whitespace-nowrap rounded-box bg-base-100 p-2 shadow-md">
  <li>
    <Button onclick={pickMedia}>
      <Icon size={4} icon={GallerySend} />
      Photos & videos
    </Button>
  </li>
  <li>
    <Button onclick={pickFile}>
      <Icon size={4} icon={File} />
      File
    </Button>
  </li>
</ul>
