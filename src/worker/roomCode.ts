import { customAlphabet } from 'nanoid'
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@/shared/protocol'

export const newRoomCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH)
