import { useStore } from '../../state/store'
import categoryEditIcon from '../../assets/images/CategoryEditButton.png'
import './FilterBar.css'

export default function FilterBar(props: { onEditCategories: () => void }): React.JSX.Element {
  const categories = useStore((s) => s.categories)
  const sorted = [...categories.filter((c) => !c.isIdle), ...categories.filter((c) => c.isIdle)]

  return (
    <div className="filter-bar">
      <div className="filter-chips">
        {sorted.map((cat) => (
          <div key={cat.id} className="filter-chip">
            <span className="filter-dot" style={{ background: cat.colorHex }} />
            <span className="filter-name">{cat.name}</span>
          </div>
        ))}
      </div>
      <div className="filter-fade" />
      <button className="filter-edit-btn" onClick={props.onEditCategories}>
        <img src={categoryEditIcon} alt="Edit categories" />
      </button>
    </div>
  )
}
