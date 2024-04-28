import { useState } from 'react'

export default () => {
    const [count, setCount] = useState(0)
    function a() {
        console.log('111')
        setCount(count + 1)
    }
    return (
        <button >
            {count}
            <p onClick={a}>a</p>
        </button>
    )
}