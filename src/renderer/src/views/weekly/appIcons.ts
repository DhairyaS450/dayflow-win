// Local favicon assets for well-known apps (Windows port stand-in for the
// upstream network favicon resolver). Unknown apps fall back to a monogram.

import youtubeIcon from '../../assets/images/YouTubeFavicon.png'
import redditIcon from '../../assets/images/RedditFavicon.png'
import chromeIcon from '../../assets/images/ChromeFavicon.png'
import safariIcon from '../../assets/images/SafariFavicon.png'
import calendarIcon from '../../assets/images/CalendarFavicon.png'
import mailIcon from '../../assets/images/MailFavicon.png'
import messagesIcon from '../../assets/images/MessagesFavicon.png'
import mapsIcon from '../../assets/images/MapsFavicon.png'
import xcodeIcon from '../../assets/images/XCodeFavicon.png'
import dayflowIcon from '../../assets/images/DayflowFavicon.png'
import xIcon from '../../assets/images/XFavicon.png'
import vscodeIcon from '../../assets/images/VSCodeFavicon.png'
import terminalIcon from '../../assets/images/TerminalFavicon.png'
import notesIcon from '../../assets/images/NotesFavicon.png'
import photosIcon from '../../assets/images/PhotosFavicon.png'
import musicIcon from '../../assets/images/MusicFavicon.png'
import googleIcon from '../../assets/images/GoogleFavicon.png'

const ICONS: Record<string, string> = {
  youtube: youtubeIcon,
  reddit: redditIcon,
  chrome: chromeIcon,
  safari: safariIcon,
  calendar: calendarIcon,
  mail: mailIcon,
  messages: messagesIcon,
  maps: mapsIcon,
  xcode: xcodeIcon,
  dayflow: dayflowIcon,
  x: xIcon,
  'vs code': vscodeIcon,
  vscode: vscodeIcon,
  terminal: terminalIcon,
  notes: notesIcon,
  photos: photosIcon,
  music: musicIcon,
  google: googleIcon
}

export function appIconFor(prettyName: string): string | null {
  return ICONS[prettyName.toLowerCase()] ?? null
}
